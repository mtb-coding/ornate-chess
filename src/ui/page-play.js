// Play is one screen: an online time control, or a game against the bot.
import { makeGamePage } from './page-game.js';
import { CLOCK_PRESETS, clockMark } from './clock.js';
import { esc } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { app } from './state.js';
import { apiBase, readAccount } from './account-client.js';
import { mods } from './modules.js';
import { mountOnlineGame } from './online-game.js';
import { storeRatings } from './online-ratings-client.js';

const botPage = makeGamePage('bot');
const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const LIVE_KEY = 'ornate-live-game';
const TIMES = CLOCK_PRESETS.filter((preset) => preset.baseMs > 0);
let lobbyNote = '';

function resumableBot() {
  try {
    const auto = mods.storage.loadAutosave();
    return Boolean(auto && auto.mode === 'bot' && auto.game && auto.game.uci && auto.game.uci.length > 0 && !auto.game.resultInfo);
  } catch { return false; }
}

function liveKey() {
  try { return sessionStorage.getItem(LIVE_KEY) || ''; } catch { return ''; }
}

function rememberGame(id) {
  try {
    if (id) sessionStorage.setItem(LIVE_KEY, id);
    else sessionStorage.removeItem(LIVE_KEY);
  } catch { /* This browser may block session storage. */ }
}

export async function render(section, ctx) {
  const query = (ctx && ctx.query) || new URLSearchParams();
  const lobby = query.get('lobby') === '1';
  const pendingBot = Boolean(app.pendingLoad && app.pendingLoad.target === 'play');
  const handle = { cleanup() {} };
  const replace = (fn) => {
    try { handle.cleanup(); } catch { /* The previous view is already gone. */ }
    handle.cleanup = typeof fn === 'function' ? fn : (() => {});
  };
  if (!lobby && (pendingBot || query.get('bot') === '1')) {
    replace(await botPage.render(section));
    return () => replace(null);
  }
  if (!lobby && liveKey() && readAccount()) openSocket(section, replace, { resume: true });
  else if (!lobby && (app.controllers.play || resumableBot())) {
    replace(await botPage.render(section));
    return () => replace(null);
  } else showLobby(section, replace);
  return () => replace(null);
}

export function onKey(e) {
  const ctrl = app.controllers.play;
  return ctrl && ctrl.root ? botPage.onKey(e) : false;
}

function showLobby(section, replace) {
  replace(mountLobby(section, replace));
}

function mountLobby(section, replace) {
  const account = readAccount();
  const note = lobbyNote;
  lobbyNote = '';
  const times = TIMES.map((preset) => {
    const mark = clockMark(preset.baseMs, preset.incMs);
    return `<button class="btn play-time" type="button" data-base="${preset.baseMs}" data-inc="${preset.incMs}" data-pace="${mark.pace}" aria-label="${esc(mark.short)}, ${esc(mark.paceLabel)}" ${account ? '' : 'disabled'}>${ICONS[mark.pace]}<span class="play-time-main">${esc(mark.short)}</span><span class="play-time-pace">${esc(mark.paceLabel)}</span></button>`;
  }).join('');
  section.innerHTML = `
    <h1 class="page-title" id="title-play">Play</h1>
    <p class="lede">Choose a time control to play another person, or play the bot on this device. The server checks every online move and keeps the clock.</p>
    ${note ? `<p class="status" role="status">${esc(note)}</p>` : ''}
    <div class="frame setup-card">${fc}<div class="frame-inner">
      <h2>Play another person</h2>
      ${DIVIDER}
      ${account ? '' : '<p class="help">Sign in on the account page to play another person. You can still play the bot on this device.</p>'}
      <fieldset><legend>Your colour</legend><div class="choice-row">
        <label class="choice"><input type="radio" name="online-color" value="w"><span><span class="pb-dot w" aria-hidden="true"></span>White</span></label>
        <label class="choice"><input type="radio" name="online-color" value="b"><span><span class="pb-dot b" aria-hidden="true"></span>Black</span></label>
        <label class="choice"><input type="radio" name="online-color" value="random" checked><span>Random</span></label>
      </div></fieldset>
      <p class="help">Random gives you either colour when an opponent is found. The first number is the minutes for each player, and the second is the seconds added after every move. Bullet is expected to last under three minutes, blitz under ten, and rapid ten minutes or more.</p>
      <div class="play-times">${times}</div>
    </div></div>
    <div class="frame setup-card">${fc}<div class="frame-inner">
      <h2>Play the bot</h2>
      ${DIVIDER}
      <p>The bot is on this device. The next step asks for a colour, a difficulty and an optional clock. A game against the bot does not use the online clock, and it is not rated.</p>
      <div class="btn-row"><a class="btn primary" href="#/play?bot=1" data-play="bot">${ICONS.play}<span>Play the bot</span></a></div>
    </div></div>`;
  section.querySelectorAll('[data-base]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!readAccount()) return;
      const picked = section.querySelector('input[name="online-color"]:checked');
      openSocket(section, replace, {
        baseMs: Number(button.dataset.base),
        incMs: Number(button.dataset.inc),
        color: picked ? picked.value : 'random',
      });
    });
  });
  return () => {};
}

function openSocket(section, replace, opts) {
  const account = readAccount();
  if (!account) {
    lobbyNote = 'Sign in on the account page to play another person.';
    showLobby(section, replace);
    return;
  }
  let alive = true;
  let opened = false;
  let view = null;
  let socket = null;
  section.innerHTML = `<h1 class="page-title" id="title-play">Play</h1><p class="lede" role="status">Connecting to the game server.</p>`;
  const cleanup = () => {
    alive = false;
    if (view) view.destroy();
    view = null;
    if (socket && socket.readyState < 2) socket.close();
  };
  try { socket = new WebSocket(`${apiBase().replace(/^http/i, 'ws')}/ws`); } catch {
    lobbyNote = 'The game server could not be reached.';
    showLobby(section, replace);
    return;
  }
  replace(cleanup);
  const fail = (text) => {
    if (!alive) return;
    lobbyNote = text || '';
    rememberGame('');
    showLobby(section, replace);
  };
  const send = (obj) => { if (alive && socket.readyState === 1) socket.send(JSON.stringify(obj)); };
  socket.addEventListener('open', () => {
    opened = true;
    if (!alive) return;
    send({ type: 'hello', token: account.token });
  });
  socket.addEventListener('message', (ev) => {
    if (!alive) return;
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'welcome') {
      if (msg.ratings) storeRatings(msg.ratings);
      if (msg.game) show(msg.game);
      else if (opts.resume && msg.recent) show(msg.recent);
      else if (opts.resume) fail('There is no online game to resume.');
      else send({ type: 'seek', baseMs: opts.baseMs, incMs: opts.incMs, color: opts.color });
    } else if (msg.type === 'seeking') showSeeking(msg.seek);
    else if (msg.type === 'game') show(msg.game);
    else if (msg.type === 'cancelled' || msg.type === 'aborted') fail(msg.error || '');
    else if (msg.type === 'error') {
      if (view) view.status(msg.error);
      else {
        const line = section.querySelector('[data-online-status]');
        if (line) line.textContent = msg.error;
        else fail(msg.error);
      }
    }
  });
  socket.addEventListener('error', () => { if (alive && !opened) fail('The game server could not be reached.'); });
  socket.addEventListener('close', () => { if (alive && !opened) fail('The game server could not be reached.'); });

  function show(state) {
    rememberGame(state.status === 'live' ? state.id : '');
    if (!view) {
      view = mountOnlineGame(section, state, { send, leave: fail });
    } else view.update(state);
  }
  function showSeeking(seek) {
    view = null;
    const colour = seek.color === 'w' ? 'White' : seek.color === 'b' ? 'Black' : 'a random colour';
    const mark = clockMark(seek.baseMs, seek.incMs);
    const asked = mark ? `${mark.short}, a ${mark.pace} game` : seek.label;
    section.innerHTML = `
      <h1 class="page-title" id="title-play">Play</h1>
      <div class="frame setup-card">${fc}<div class="frame-inner">
        <h2>Waiting for an opponent</h2>
        ${DIVIDER}
        <p class="status" role="status" data-online-status>Waiting for an opponent for ${esc(asked)}. You asked to play ${esc(colour)}.</p>
        <div class="btn-row"><button class="btn" type="button" data-act="cancel">Cancel the search</button></div>
      </div></div>`;
    section.querySelector('[data-act="cancel"]').addEventListener('click', () => send({ type: 'cancel' }));
  }
}
