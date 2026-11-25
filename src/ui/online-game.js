// Board for one server-owned game. The server decides legality, the clock and the result.
import { Game, moveToUci } from '../engine.js';
import { Board } from './board.js';
import { formatClock } from './clock.js';
import { esc, describeResult, toast } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { confirmDialog } from './dialogs.js';
import { settings, onSettings, app } from './state.js';
import { play as sfx, soundForMove } from './sound.js';
import { mods } from './modules.js';
import { formatGlicko } from '../glicko.js';
import { PACE_LABEL } from '../online-ratings.js';
import { storeRatings } from './online-ratings-client.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;

function sideName(state, color) {
  const seat = color === 'w' ? state.white : state.black;
  return color === state.you ? `${seat.username} (you)` : seat.username;
}

function moveList(game) {
  const sans = game.sans;
  let html = '<ol class="moves online-moves">';
  for (let i = 0; i < sans.length; i += 2) {
    const current = (idx) => (idx === sans.length - 1 ? ' current' : '');
    html += `<li><span class="mvn">${(i / 2) + 1}.</span><span class="mv${current(i)}">${esc(sans[i])}</span>`;
    html += i + 1 < sans.length ? `<span class="mv${current(i + 1)}">${esc(sans[i + 1])}</span>` : '<span class="mv empty"></span>';
    html += '</li>';
  }
  html += '</ol>';
  return html;
}

export function mountOnlineGame(section, initial, actions) {
  let state = initial;
  let saved = false;
  const s = settings();
  section.innerHTML = `
    <h1 class="page-title" id="title-play">Play</h1>
    <p class="lede">This game is played online. The server checks every move and keeps the clock.</p>
    <div class="game-layout mode-online">
      <div class="board-col">
        <div class="player-bar" data-slot="top"></div>
        <div class="board-row-wrap"><div class="board-host"></div></div>
        <div class="player-bar" data-slot="bottom"></div>
      </div>
      <aside class="side-col">
        <div class="frame panel">${fc}<div class="frame-inner">
          <p class="status" role="status"></p>
          <p class="help" data-draw-note></p>
          <div class="controls" role="toolbar" aria-label="Game controls"></div>
          ${DIVIDER}
          <h3 class="engraved small">Moves</h3>
          <div class="movelist" tabindex="0" role="region" aria-label="Move list"></div>
          ${DIVIDER}
          <h3 class="engraved small">Chat</h3>
          <div class="chat-host"></div>
        </div></div>
      </aside>
    </div>`;
  const root = section;
  const board = new Board(root.querySelector('.board-host'), {
    pieceSet: s.pieceSet,
    orientation: state.you === 'b' ? 'b' : 'w',
    showLegal: s.showLegal,
    showCoords: s.showCoords,
    animations: s.animations,
    autoQueen: s.autoQueen,
    label: 'Chess board. Use the arrow keys to move between squares and Enter to select a piece or a destination.',
    onMove(move) {
      board.setMovable(null);
      actions.send({ type: 'move', gameId: state.id, uci: moveToUci(move) });
    },
  });
  let offset = state.serverNow - Date.now();
  let ply = null;
  const unsub = onSettings((next) => {
    board.setOptions({ pieceSet: next.pieceSet, showLegal: next.showLegal, showCoords: next.showCoords, animations: next.animations, autoQueen: next.autoQueen });
    paint(false);
  });
  const timer = setInterval(() => paintClocks(), 100);

  function game() { return Game.fromJSON(state.game); }

  function remaining(parsed, color) {
    const base = color === 'w' ? state.wMs : state.bMs;
    if (state.status !== 'live' || state.turnStartedAt == null || parsed.turn !== color) return base;
    return Math.max(0, base - (Date.now() + offset - state.turnStartedAt));
  }

  function paintClocks() {
    const parsed = game();
    for (const color of ['w', 'b']) {
      const el = root.querySelector(`.pb-clock[data-clock="${color}"]`);
      if (!el) return;
      const left = remaining(parsed, color);
      const running = state.status === 'live' && parsed.turn === color;
      el.textContent = formatClock(left);
      el.classList.toggle('running', running);
      el.classList.toggle('low', running && left < 10000);
    }
  }

  function statusText(parsed) {
    if (state.status === 'finished' && state.result) return describeResult({ result: state.result, reason: state.resultReason });
    if (state.status !== 'live') return 'The game is over.';
    if (!state.opponentConnected) return 'Your opponent is disconnected. The clock is still running.';
    const mine = parsed.turn === state.you;
    if (parsed.position.inCheck()) return mine ? 'It is your move, and your king is in check.' : 'Your opponent is in check.';
    return mine ? 'It is your move.' : `${state.you === 'w' ? state.black.username : state.white.username} is to move.`;
  }

  function paint(sound) {
    const parsed = game();
    if (sound && ply != null && parsed.length === ply + 1 && parsed.lastMove) sfx(soundForMove(parsed.lastMove, parsed.position));
    ply = parsed.length;
    const bottom = state.you === 'b' ? 'b' : 'w';
    const top = bottom === 'w' ? 'b' : 'w';
    for (const [slot, color] of [['top', top], ['bottom', bottom]]) {
      const bar = root.querySelector(`.player-bar[data-slot="${slot}"]`);
      const turn = state.status === 'live' && parsed.turn === color;
      bar.className = `player-bar${turn ? ' to-move' : ''}`;
      bar.dataset.slot = slot;
      bar.innerHTML = `<span class="pb-dot ${color}" aria-hidden="true"></span><span class="pb-name">${esc(sideName(state, color))}</span><span class="pb-clock" data-clock="${color}" role="timer" aria-label="${color === 'w' ? 'White' : 'Black'} clock"></span>`;
    }
    board.setOptions({ orientation: bottom });
    board.setPosition(parsed.position, { lastMove: parsed.lastMove, animate: sound && parsed.length > 0 });
    const movable = state.status === 'live' && parsed.turn === state.you ? state.you : null;
    board.setMovable(movable);
    root.querySelector('.status').textContent = statusText(parsed);
    const note = root.querySelector('[data-draw-note]');
    if (state.status === 'live' && state.drawOffer === state.you) note.textContent = 'You offered a draw.';
    else if (state.status === 'live' && state.drawOffer) note.textContent = 'Your opponent offered a draw.';
    else if (state.rating) {
      const name = (PACE_LABEL[state.rating.pace] || 'Online').toLowerCase();
      const now = formatGlicko(state.rating.after, state.rating.deviation);
      const points = Math.abs(state.rating.delta);
      const word = points === 1 ? 'point' : 'points';
      const change = state.rating.delta > 0 ? `${points} ${word} higher` : state.rating.delta < 0 ? `${points} ${word} lower` : 'unchanged';
      note.textContent = `Your ${name} rating is now ${now}, which is ${change}.`;
    } else note.textContent = '';
    root.querySelector('.movelist').innerHTML = parsed.length ? moveList(parsed) : '<p class="muted">No moves have been played yet.</p>';
    const controls = root.querySelector('.controls');
    const btn = (act, icon, label) => `<button class="btn" type="button" data-act="${act}">${ICONS[icon]}<span>${label}</span></button>`;
    let html = '';
    if (state.status === 'live') {
      if (state.drawOffer && state.drawOffer !== state.you) {
        html += btn('accept', 'handshake', 'Accept the draw') + btn('decline', 'flag', 'Decline the draw');
      } else if (!state.drawOffer) html += btn('draw', 'handshake', 'Offer a draw');
      html += btn('resign', 'flag', 'Resign');
    } else {
      html += btn('analyse', 'next', 'Analyse') + `<a class="btn" href="#/play?lobby=1">${ICONS.play}<span>Return to Play</span></a>`;
    }
    controls.innerHTML = html;
    paintClocks();
    paintChat();
    if (state.rating && state.rating.document) storeRatings(state.rating.document);
    if (state.status === 'finished' && !saved) {
      saved = true;
      try {
        const record = {
          name: `Online game against ${state.you === 'w' ? state.black.username : state.white.username}`,
          mode: 'online',
          playerColor: state.you,
          game: {
            ...state.game,
            headers: { ...(state.game.headers || {}), Event: 'Ornate Chess online', White: state.white.username, Black: state.black.username },
          },
          clock: { wMs: state.wMs, bMs: state.bMs, incMs: state.incMs },
        };
        mods.storage.saveGame(record);
        toast('This game was saved on this device.');
      } catch (err) { toast(`The game could not be saved: ${err.message}`); }
    }
  }

  function paintChat() {
    const host = root.querySelector('.chat-host');
    if (!host) return;
    const chat = state.chat || { state: 'closed', outgoing: false, messages: [] };
    const otherName = state.you === 'w' ? state.black.username : state.white.username;
    const lines = (chat.messages || []).map((entry) => `<p class="chat-line${entry.yours ? ' yours' : ''}">${esc(entry.text)}</p>`).join('');
    const log = lines ? `<div class="chat-log" role="log" aria-label="In-game chat">${lines}</div>` : '';
    let controls = '';
    if (state.status === 'live') {
      if (chat.state === 'closed') controls = '<button class="btn" type="button" data-chat="chat-request">Ask to chat</button>';
      else if (chat.state === 'requested' && chat.outgoing) controls = '<p class="help">You asked to chat. Waiting for a reply.</p>';
      else if (chat.state === 'requested') {
        controls = `<p class="help">${esc(otherName)} asked to chat.</p><div class="btn-row"><button class="btn" type="button" data-chat="chat-accept">Accept</button><button class="btn" type="button" data-chat="chat-decline">Decline</button></div>`;
      } else if (chat.state === 'open') {
        controls = `<form class="chat-form" aria-label="Send a message"><label class="visually-hidden" for="game-chat">Message</label><input id="game-chat" class="field" name="text" maxlength="240" autocomplete="off" required><button class="btn" type="submit">Send</button></form>`;
      } else controls = '<p class="help">Chat was declined for this game.</p>';
    } else if (!lines) controls = '<p class="muted">No chat in this game.</p>';
    const draft = host.querySelector('input[name="text"]');
    const keep = draft ? draft.value : '';
    const focused = draft && document.activeElement === draft;
    host.innerHTML = log + controls;
    const input = host.querySelector('input[name="text"]');
    if (input && keep) input.value = keep;
    if (input && focused) input.focus();
    const box = host.querySelector('.chat-log');
    if (box) box.scrollTop = box.scrollHeight;
  }

  root.querySelector('.chat-host').addEventListener('click', (event) => {
    const button = event.target.closest('[data-chat]');
    if (!button || !root.contains(button)) return;
    actions.send({ type: button.dataset.chat, gameId: state.id });
  });
  root.querySelector('.chat-host').addEventListener('submit', (event) => {
    if (!event.target.classList || !event.target.classList.contains('chat-form')) return;
    event.preventDefault();
    const text = event.target.text.value;
    event.target.text.value = '';
    actions.send({ type: 'chat', gameId: state.id, text });
  });

  root.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-act]');
    if (!button || !root.contains(button)) return;
    const act = button.dataset.act;
    if (act === 'resign') {
      const ok = await confirmDialog('Resign the game', 'You will lose this game. Do you want to resign?', { ok: 'Resign', danger: true });
      if (ok) actions.send({ type: 'resign', gameId: state.id });
    } else if (act === 'draw' || act === 'accept') actions.send({ type: 'draw', gameId: state.id });
    else if (act === 'decline') actions.send({ type: 'decline', gameId: state.id });
    else if (act === 'analyse') {
      app.pendingLoad = {
        target: 'analysis',
        record: {
          name: `Online game against ${state.you === 'w' ? state.black.username : state.white.username}`,
          mode: 'online',
          playerColor: state.you,
          game: state.game,
        },
      };
      location.hash = '#/analysis';
    }
  });

  paint(false);

  return {
    update(next) {
      const grew = Game.fromJSON(next.game).length > (ply || 0);
      state = next;
      offset = next.serverNow - Date.now();
      paint(grew);
    },
    status(text) {
      const el = root.querySelector('.status');
      if (el) el.textContent = text;
      if (state.status === 'live') {
        const parsed = game();
        board.setMovable(parsed.turn === state.you ? state.you : null);
      }
    },
    destroy() {
      clearInterval(timer);
      unsub();
      board.setMovable(null);
    },
  };
}
