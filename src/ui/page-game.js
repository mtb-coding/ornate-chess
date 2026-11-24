// Shared page logic for the Play (bot) and Local (two-player) pages.
import { mods } from './modules.js';
import { app, settings, updateSettings, difficulty, levelDescription } from './state.js';
import { GameController } from './gameview.js';
import { CLOCK_PRESETS } from './clock.js';
import { esc, formatDate, toast } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { confirmDialog } from './dialogs.js';
import { MIN_FULLMOVES, autosaveForfeitsAsLoss, formatRating } from '../rating.js';
import { Game } from '../engine.js';

// ---- Custom clock -----------------------------------------------------------
export const CUSTOM_LIMITS = { minMin: 0.5, maxMin: 180, minInc: 0, maxInc: 60 };
const CUSTOM_DEFAULT = { active: false, minutes: 10, inc: 5, split: false, blackMinutes: 10 };

function plural(n, unit) { return `${n} ${unit}${n === 1 ? '' : 's'}`; }
function minutesText(m) { return m < 1 ? plural(Math.round(m * 60), 'second') : plural(m, 'minute'); }

/** Plain-sentence label, for example "7 minutes plus 3 seconds per move". */
export function customClockLabel({ minutes, inc, split, blackMinutes }) {
  const base = split && blackMinutes !== minutes ? `${minutesText(minutes)} for White and ${minutesText(blackMinutes)} for Black` : minutesText(minutes);
  return inc > 0 ? `${base} plus ${plural(inc, 'second')} per move` : base;
}

/** Returns {errors:[sentence], value} for raw input strings. */
export function validateCustomClock(raw) {
  const errors = [];
  const num = (v) => (String(v).trim() === '' ? NaN : Number(String(v).replace(',', '.')));
  const L = CUSTOM_LIMITS;
  const minutes = num(raw.minutes), inc = num(raw.inc), blackMinutes = raw.split ? num(raw.blackMinutes) : minutes;
  const checkMin = (v, who) => {
    if (!Number.isFinite(v)) errors.push(`Enter the minutes ${who} as a number between ${L.minMin} and ${L.maxMin}.`);
    else if (v < L.minMin || v > L.maxMin) errors.push(`The minutes ${who} must be between ${L.minMin} and ${L.maxMin}.`);
  };
  checkMin(minutes, raw.split ? 'for White' : 'per side');
  if (raw.split) checkMin(blackMinutes, 'for Black');
  if (!Number.isFinite(inc)) errors.push(`Enter the increment as a number of seconds between ${L.minInc} and ${L.maxInc}.`);
  else if (inc < L.minInc || inc > L.maxInc) errors.push(`The increment must be between ${L.minInc} and ${L.maxInc} seconds.`);
  if (errors.length) return { errors, value: null };
  const r = (v, d) => Math.round(v * d) / d;
  return { errors, value: { minutes: r(minutes, 100), inc: r(inc, 10), split: !!raw.split, blackMinutes: r(blackMinutes, 100) } };
}

function customPreset(v) {
  const wMs = Math.round(v.minutes * 60e3), bMs = Math.round((v.split ? v.blackMinutes : v.minutes) * 60e3);
  return { id: 'custom', label: customClockLabel(v), baseMs: Math.max(wMs, bMs), wMs, bMs, incMs: Math.round(v.inc * 1000) };
}

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;

/**
 * source: 'autosave' keeps the rating state stored with the game (older
 * autosaves without it are unrated); 'loaded' marks games opened from the
 * saved games library, which are never rated.
 */
export function controllerFromRecord(record, mode, source = 'loaded') {
  const { Game } = mods.engine;
  const game = Game.fromJSON(record.game);
  const clock = record.clock && (record.clock.wMs > 0 || record.clock.bMs > 0) ? { baseMs: Math.max(record.clock.wMs, record.clock.bMs), wMs: record.clock.wMs, bMs: record.clock.bMs, incMs: record.clock.incMs || 0 } : null;
  let rating = null;
  if (mode === 'bot') {
    if (source === 'autosave') rating = record.rating && typeof record.rating === 'object' ? { ...record.rating } : { legacy: true };
    else rating = { ...(record.rating || {}), loaded: true };
  }
  const c = new GameController({ mode, game, playerColor: record.playerColor || 'w', botLevel: record.botLevel || settings().lastBotLevel, clockPreset: clock, name: record.name || '', autoRotate: mode === 'local' && settings().autoRotateLocal !== false, rating });
  if (record.id) c.savedId = record.id;
  return c;
}

/** Scores an abandoned rated autosave as a loss. Returns the toast sentence. */
function openingFromRecord(record) {
  try {
    const identify = mods.openings && mods.openings.identifyOpeningForGame;
    if (!identify || !record || !record.game) return null;
    return identify(Game.fromJSON(record.game));
  } catch { return null; }
}

function forfeitAutosave(auto) {
  const lvl = difficulty(auto.botLevel);
  const color = auto.playerColor === 'b' ? 'b' : 'w';
  try { mods.storage.recordResult({ mode: 'bot', botLevel: lvl.id, playerColor: color, result: color === 'w' ? '0-1' : '1-0', opening: openingFromRecord(auto) }); } catch (err) { console.warn('[stats]', err.message); }
  const u = mods.storage.recordRatedGame({ botLevel: lvl.id, opponent: lvl.elo, score: 0 });
  mods.storage.clearAutosave();
  return `The unfinished game was counted as a loss, and your rating is now ${formatRating(u.after, u.games)}.`;
}

/** Asks before a rated autosave past move 5 is thrown away. Resolves true when the caller may continue. */
async function confirmAutosaveForfeit(auto, action) {
  // When the rated game is still open on the Play page, end it there instead.
  const live = app.controllers.play;
  if (live && auto && auto.mode === 'bot' && live.abandonCountsAsLoss()) {
    if (!(await live.confirmAbandon(action))) return false;
    live.destroy(); delete app.controllers.play;
    return true;
  }
  if (!autosaveForfeitsAsLoss(auto, auto && difficulty(auto.botLevel).elo)) return true;
  const ok = await confirmDialog('End the rated game', `The saved game in progress is rated and has passed move ${MIN_FULLMOVES}. ${action} ends it, and it will count as a loss for your rating in the same way as a resignation. Do you want to continue?`, { ok: 'Count it as a loss and continue', danger: true });
  if (!ok) return false;
  try { toast(forfeitAutosave(auto)); } catch (err) { toast(`The result could not be stored: ${err.message}`); }
  return true;
}

export function makeGamePage(mode) {
  const isBot = mode === 'bot';
  const key = isBot ? 'play' : 'local';
  let rootEl = null;

  function attach(ctrl) {
    app.controllers[key] = ctrl;
    ctrl.onNewGame = () => {
      ctrl.destroy();
      delete app.controllers[key];
      mods.storage.clearAutosave();
      showSetup();
    };
    ctrl.onAnalyse = (record) => { app.pendingLoad = { target: 'analysis', record }; location.hash = '#/analysis'; };
    ctrl.onReview = (record) => { app.pendingLoad = { target: 'review', record }; location.hash = '#/review'; };
    const host = rootEl.querySelector('.game-host');
    host.innerHTML = '';
    rootEl.querySelector('.setup-host').innerHTML = '';
    ctrl.mount(host);
    window.__chess.controller = ctrl;
  }

  function showSetup() {
    const host = rootEl.querySelector('.setup-host');
    rootEl.querySelector('.game-host').innerHTML = '';
    window.__chess.controller = null;
    const s = settings();
    const auto = mods.storage.loadAutosave();
    const resumable = auto && auto.mode === mode && auto.game && auto.game.uci && auto.game.uci.length > 0 && !auto.game.resultInfo;
    const levels = mods.ai.DIFFICULTIES;
    const levelOpts = levels.map((d) => `<option value="${esc(d.id)}" ${d.id === s.lastBotLevel ? 'selected' : ''}>${esc(d.name)}${d.elo ? ` (about ${d.elo})` : ''}</option>`).join('');
    const cc = { ...CUSTOM_DEFAULT, ...(s.customClock || {}) };
    const clockOpts = CLOCK_PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
    host.innerHTML = `
      ${resumable ? `<div class="frame resume-card" role="region" aria-labelledby="resume-title">${fc}<div class="frame-inner">
        <h2 id="resume-title">Resume the saved game</h2>
        <p>A game in progress was saved automatically on ${esc(formatDate(auto.savedAt))} after ${auto.game.uci.length} ${auto.game.uci.length === 1 ? 'move' : 'moves'}${isBot && auto.botLevel ? ` against the ${esc(difficulty(auto.botLevel).name)} level` : ''}.</p>
        <div class="btn-row"><button class="btn primary" type="button" data-setup="resume">${ICONS.play}<span>Resume the game</span></button><button class="btn" type="button" data-setup="discard">${ICONS.trash}<span>Discard it</span></button></div>
      </div></div>` : ''}
      <form class="frame setup-card" aria-labelledby="setup-title">${fc}<div class="frame-inner">
        <h2 id="setup-title">${isBot ? 'Set up a game against the bot' : 'Set up a game for two players'}</h2>
        ${DIVIDER}
        ${isBot ? `<fieldset><legend>Your colour</legend><div class="choice-row">
          <label class="choice"><input type="radio" name="color" value="w" checked><span><span class="pb-dot w" aria-hidden="true"></span>White</span></label>
          <label class="choice"><input type="radio" name="color" value="b"><span><span class="pb-dot b" aria-hidden="true"></span>Black</span></label>
          <label class="choice"><input type="radio" name="color" value="random"><span>Random</span></label></div></fieldset>
        <label for="setup-level">Bot difficulty</label>
        <select id="setup-level" class="field" name="level">${levelOpts}</select>
        <p class="help" id="level-desc" aria-live="polite"></p>
        <p class="help">A game against the bot is not rated. Bullet, blitz and rapid ratings come from online games.</p>` : `
        <label class="toggle"><input type="checkbox" name="rotate" ${s.autoRotateLocal !== false ? 'checked' : ''} aria-describedby="rotate-help"><span>Flip the board after each move</span></label>
        <p class="help" id="rotate-help">When this is on, the side to move is always shown at the bottom of the board, including after Undo, Redo and stepping through the moves. This setting also applies when a saved game is resumed.</p>`}
        <label for="setup-clock">Clock</label>
        <div class="clock-row">
          <select id="setup-clock" class="field" name="clock" aria-describedby="clock-preset-note">${clockOpts}</select>
          <button class="btn clock-custom-btn" type="button" data-setup="custom" aria-pressed="${cc.active}" aria-controls="custom-clock">${ICONS.pen}<span>Custom</span></button>
        </div>
        <p class="help" id="clock-preset-note">${cc.active ? 'The preset list is not used while a custom time is selected. Select Custom again to return to the presets.' : 'The clock is optional. With an increment, the stated number of seconds is added after each move.'}</p>
        <fieldset class="custom-clock" id="custom-clock" ${cc.active ? '' : 'hidden'}>
          <legend>Custom time</legend>
          <div class="custom-grid">
            <div><label for="cc-min" id="cc-min-label">${cc.split ? 'Minutes for White' : 'Minutes per side'}</label>
              <input id="cc-min" class="field" type="number" inputmode="decimal" name="ccMinutes" min="${CUSTOM_LIMITS.minMin}" max="${CUSTOM_LIMITS.maxMin}" step="any" value="${esc(String(cc.minutes))}" aria-describedby="cc-min-help"></div>
            <div class="cc-black" ${cc.split ? '' : 'hidden'}><label for="cc-bmin">Minutes for Black</label>
              <input id="cc-bmin" class="field" type="number" inputmode="decimal" name="ccBlackMinutes" min="${CUSTOM_LIMITS.minMin}" max="${CUSTOM_LIMITS.maxMin}" step="any" value="${esc(String(cc.blackMinutes))}" aria-describedby="cc-min-help"></div>
            <div><label for="cc-inc">Increment in seconds</label>
              <input id="cc-inc" class="field" type="number" inputmode="decimal" name="ccInc" min="${CUSTOM_LIMITS.minInc}" max="${CUSTOM_LIMITS.maxInc}" step="any" value="${esc(String(cc.inc))}" aria-describedby="cc-inc-help"></div>
          </div>
          <p class="help" id="cc-min-help">Minutes can be from ${CUSTOM_LIMITS.minMin} to ${CUSTOM_LIMITS.maxMin} and may include decimals, such as 1.5.</p>
          <p class="help" id="cc-inc-help">The increment can be from ${CUSTOM_LIMITS.minInc} to ${CUSTOM_LIMITS.maxInc} seconds and is added after each move.</p>
          <label class="toggle"><input type="checkbox" name="ccSplit" ${cc.split ? 'checked' : ''}><span>Give White and Black different amounts of time.</span></label>
          <div class="cc-errors" role="alert"></div>
        </fieldset>
        <p class="clock-summary" aria-live="polite"></p>
        <div class="btn-row setup-actions"><p class="disabled-reason help" id="start-reason" hidden></p><button class="btn primary" type="submit" aria-describedby="start-reason">${ICONS.play}<span>Start the game</span></button></div>
      </div></form>`;
    const form = host.querySelector('form');
    const desc = host.querySelector('#level-desc');
    const levelSel = host.querySelector('#setup-level');
    const showDesc = () => { if (desc) { const d = difficulty(levelSel.value); desc.textContent = levelDescription(d); } };
    if (levelSel) { levelSel.addEventListener('change', showDesc); showDesc(); }
    // Custom clock: inline panel, validation and summary.
    const clockSel = form.querySelector('#setup-clock');
    const customBtn = form.querySelector('[data-setup="custom"]');
    const panel = form.querySelector('#custom-clock');
    const errBox = form.querySelector('.cc-errors');
    const summary = form.querySelector('.clock-summary');
    const startBtn = form.querySelector('button[type="submit"]');
    const reason = form.querySelector('#start-reason');
    const note = form.querySelector('#clock-preset-note');
    let customOn = cc.active;
    const readCustom = () => validateCustomClock({ minutes: form.ccMinutes.value, inc: form.ccInc.value, split: form.ccSplit.checked, blackMinutes: form.ccBlackMinutes.value });
    const refreshClock = (persist) => {
      panel.hidden = !customOn;
      customBtn.setAttribute('aria-pressed', String(customOn));
      clockSel.disabled = customOn;
      note.textContent = customOn ? 'The preset list is not used while a custom time is selected. Select Custom again to return to the presets.' : 'The clock is optional. With an increment, the stated number of seconds is added after each move.';
      form.querySelector('.cc-black').hidden = !form.ccSplit.checked;
      form.querySelector('#cc-min-label').textContent = form.ccSplit.checked ? 'Minutes for White' : 'Minutes per side';
      let blocked = '';
      if (customOn) {
        const { errors, value } = readCustom();
        errBox.innerHTML = errors.map((e) => `<p class="field-error">${esc(e)}</p>`).join('');
        for (const [name, bad] of [['ccMinutes', errors.some((e) => /minutes (per side|for White)/.test(e))], ['ccBlackMinutes', errors.some((e) => /for Black/.test(e))], ['ccInc', errors.some((e) => /increment/.test(e))]]) form[name].setAttribute('aria-invalid', String(bad));
        if (value) {
          summary.textContent = `The custom clock is ready: ${customClockLabel(value)}.`;
          if (persist) updateSettings({ customClock: { ...value, active: true } });
        } else {
          summary.textContent = 'The custom clock is not ready because a value is out of range.';
          blocked = 'The game cannot start until the custom time is corrected.';
        }
      } else {
        errBox.innerHTML = '';
        const p = CLOCK_PRESETS.find((x) => x.id === clockSel.value);
        summary.textContent = p && p.baseMs ? `The selected clock is ${p.label}.` : 'The game will be played without a clock.';
        if (persist) updateSettings({ customClock: { ...(settings().customClock || cc), active: false } });
      }
      startBtn.disabled = !!blocked;
      reason.textContent = blocked; reason.hidden = !blocked;
    };
    customBtn.addEventListener('click', () => { customOn = !customOn; refreshClock(true); if (customOn) form.ccMinutes.focus(); });
    form.addEventListener('input', (e) => { if (e.target.closest('#custom-clock') || e.target === clockSel) refreshClock(true); });
    form.addEventListener('change', (e) => { if (e.target.name === 'rotate') updateSettings({ autoRotateLocal: e.target.checked }); });
    form.addEventListener('change', (e) => { if (e.target === clockSel || e.target.name === 'ccSplit') refreshClock(true); });
    refreshClock(false);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Starting a game replaces the automatic save, so a rated game in it is abandoned.
      const current = mods.storage.loadAutosave();
      if (!(await confirmAutosaveForfeit(current, 'Starting a new game'))) return;
      const fd = new FormData(form);
      let preset = CLOCK_PRESETS.find((p) => p.id === fd.get('clock'));
      if (customOn) {
        const { value } = readCustom();
        if (!value) { refreshClock(false); form.ccMinutes.focus(); return; }
        updateSettings({ customClock: { ...value, active: true } });
        preset = customPreset(value);
      }
      let color = fd.get('color') || 'w';
      if (color === 'random') color = Math.random() < 0.5 ? 'w' : 'b';
      const level = fd.get('level') || s.lastBotLevel;
      if (isBot) updateSettings({ lastBotLevel: level });
      if (!isBot) updateSettings({ autoRotateLocal: fd.get('rotate') === 'on' });
      const ctrl = new GameController({ mode, playerColor: color, botLevel: level, clockPreset: preset && preset.baseMs ? { ...preset } : null, autoRotate: !isBot && fd.get('rotate') === 'on', rating: isBot ? { rated: false } : null });
      attach(ctrl);
    });
    host.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-setup]'); if (!b) return;
      if (b.dataset.setup === 'resume') {
        try { attach(controllerFromRecord(auto, mode, 'autosave')); } catch (err) { toast(`The saved game could not be restored: ${err.message}`); }
      } else if (b.dataset.setup === 'discard') {
        if (autosaveForfeitsAsLoss(auto, difficulty(auto.botLevel).elo)) {
          if (await confirmAutosaveForfeit(auto, 'Discarding it')) showSetup();
        } else if (await confirmDialog('Discard the saved game', 'The automatically saved game will be deleted. Do you want to continue?', { ok: 'Discard', danger: true })) { mods.storage.clearAutosave(); showSetup(); }
      }
    });
  }

  return {
    async render(root) {
      rootEl = root;
      root.innerHTML = `<h1 class="page-title" id="title-${key}">${isBot ? 'Play against the bot' : 'Two-player game'}</h1>
        <p class="lede">${isBot ? 'Choose a colour, a difficulty and an optional clock. The game is saved automatically after every move.' : 'Two people take turns on this device. The game is saved automatically after every move.'}</p>
        ${isBot ? '<p class="help"><a href="#/play?lobby=1">Return to the Play page to choose an online time control.</a></p>' : ''}
        <div class="setup-host"></div><div class="game-host"></div>`;
      const pending = app.pendingLoad && app.pendingLoad.target === key ? app.pendingLoad : null;
      if (pending) {
        app.pendingLoad = null;
        const running = app.controllers[key];
        if (running && !(await running.confirmAbandon('Opening another game'))) { attach(running); return () => { const c = app.controllers[key]; if (c) c.unmount(); rootEl = null; }; }
        if (app.controllers[key]) app.controllers[key].destroy();
        try { attach(controllerFromRecord(pending.record, mode)); } catch (err) { toast(`The game could not be loaded: ${err.message}`); showSetup(); }
      } else if (app.controllers[key]) attach(app.controllers[key]);
      else showSetup();
      return () => { const c = app.controllers[key]; if (c) c.unmount(); rootEl = null; };
    },
    onKey(e) { const c = app.controllers[key]; return c && c.root ? c.handleKey(e) : false; },
  };
}
