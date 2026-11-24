// Game controller and view used by the Play, Local and Analysis pages.
// All rules come from engine.js Game/Position; this module only presents
// state and forwards user intent.
import { mods } from './modules.js';
import { Board } from './board.js';
import { bot, BotClient } from './bot.js';
import { Clock, formatClock } from './clock.js';
import { esc, sqName, toast, describeResult, download, copyText, safeFileName } from './dom.js';
import { ICONS, CORNER, DIVIDER } from './ornament.js';
import { pieceSvg } from './pieces.js';
import { play as sfx, soundForMove } from './sound.js';
import { settings, updateSettings, difficulty, onSettings } from './state.js';
import { confirmDialog, gameOverDialog, promptDialog } from './dialogs.js';
import { ratedStatus, playerScore, formatRating, MIN_FULLMOVES } from '../rating.js';
import { readRating, ratingChangeHtml } from './rating-view.js';

const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
export const evalClient = new BotClient();

export function materialInfo(position) {
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const pc of position.board) if (pc && pc.type !== 'k') count[pc.color][pc.type]++;
  const V = mods.engine.PIECE_VALUES;
  const captured = { w: [], b: [] }; // pieces captured BY that colour
  for (const c of ['w', 'b']) {
    const opp = c === 'w' ? 'b' : 'w';
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const missing = Math.max(0, START_COUNT[t] - count[opp][t]);
      for (let i = 0; i < missing; i++) captured[c].push(t);
    }
  }
  let w = 0, b = 0;
  for (const t of Object.keys(START_COUNT)) { w += count.w[t] * V[t]; b += count.b[t] * V[t]; }
  return { captured, diff: Math.round((w - b) / 100) };
}

function formatScore(cpWhite, mateHint) {
  if (mateHint) return mateHint;
  const v = cpWhite / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}


export class GameController {
  constructor({ mode, playerColor = 'w', botLevel = 'lvl4', clockPreset = null, game = null, name = '', autoRotate = false, rating = null }) {
    const { Game } = mods.engine;
    this.mode = mode;
    this.playerColor = playerColor;
    this.botColor = mode === 'bot' ? (playerColor === 'w' ? 'b' : 'w') : null;
    this.botLevel = botLevel;
    this.game = game || new Game();
    this.name = name;
    this.autoRotate = autoRotate;
    this.flipped = false; // manual Flip, applied on top of the derived orientation
    this.viewPly = this.game.moves.length;
    this.clockPreset = clockPreset;
    this.clock = null;
    this.thinkToken = 0;
    this.over = !!this.game.result();
    this.evalScore = null;
    this.analysisLines = [];
    this.savedId = null;
    this.root = null;
    this.reported = this.over;
    this.drawOfferedAt = -10;
    // Rating bookkeeping for bot games. See src/rating.js for the rules.
    this.ratingMeta = { rated: true, usedUndo: false, usedHint: false, loaded: false, legacy: false, recorded: false, ...(rating || {}) };
    this.ratingOutcome = null;
    if (clockPreset && clockPreset.baseMs > 0) {
      this.clock = new Clock({
        wMs: clockPreset.wMs ?? clockPreset.baseMs, bMs: clockPreset.bMs ?? clockPreset.baseMs, incMs: clockPreset.incMs || 0,
        onTick: () => this.renderClocks(), onFlag: (c) => this.flag(c),
      });
    }
  }

  get position() { return this.game.positions[this.viewPly] || this.game.position; }
  get atEnd() { return this.viewPly === this.game.moves.length; }

  /** Rated status of this game so far, or at its end when `end` is given. */
  ratingStatus(end = null) {
    const level = this.mode === 'bot' ? difficulty(this.botLevel) : null;
    return ratedStatus({ mode: this.mode, ...this.ratingMeta, botElo: level ? level.elo : null }, end);
  }

  /** True when an action such as Undo or Hint would make a rated game unrated. */
  wouldLoseRating() { return this.mode === 'bot' && !this.ratingMeta.recorded && !this.game.result() && this.ratingStatus().rated; }

  ratingNoteText() {
    if (this.mode !== 'bot') return '';
    if (this.ratingOutcome) return this.ratingOutcome.rated ? `This game was rated, and your rating is now ${formatRating(this.ratingOutcome.after, this.ratingOutcome.games)}.` : this.ratingOutcome.text;
    const st = this.ratingStatus();
    if (!st.rated) return st.text;
    const r = readRating(mods.storage);
    const d = difficulty(this.botLevel);
    return `This game is rated. Your rating is ${formatRating(r.rating, r.games)}, and the ${d.name} level is rated about ${d.elo}.`;
  }

  /** True when leaving this unfinished game now would be scored as a loss. */
  abandonCountsAsLoss() {
    return this.mode === 'bot' && !this.game.result() && !this.ratingMeta.recorded && this.ratingStatus().rated && this.game.moves.length >= (MIN_FULLMOVES - 1) * 2;
  }

  /** Asks before abandoning a rated game past move 5. Resolves true when the caller may continue. */
  async confirmAbandon(action = 'Starting a new game') {
    if (!this.abandonCountsAsLoss()) return true;
    const ok = await confirmDialog('End the rated game', `This rated game has passed move ${MIN_FULLMOVES}. ${action} now ends it, and it will count as a loss for your rating in the same way as a resignation. Do you want to continue?`, { ok: 'Count it as a loss and continue', danger: true });
    if (!ok) return false;
    this.forfeit();
    return true;
  }

  /** Ends the game as a resignation without the game-over dialog and records it. */
  forfeit() {
    if (this.game.result()) return;
    this.thinkToken++; bot.cancel();
    if (this.clock) this.clock.stop();
    this.game.resign(this.playerColor);
    const res = this.game.result();
    this.reported = true; this.over = true;
    try { mods.storage.recordResult({ mode: 'bot', botLevel: this.botLevel, playerColor: this.playerColor, result: res.result, opening: this.opening() }); } catch (err) { console.warn('[stats]', err.message); }
    const o = this.settleRating(res);
    mods.storage.clearAutosave();
    if (o && o.rated) toast(`The unfinished game was counted as a loss, and your rating is now ${formatRating(o.after, o.games)}.`);
    this.render();
  }

  async requestNewGame() {
    if (!(await this.confirmAbandon('Starting a new game'))) return;
    if (this.onNewGame) this.onNewGame();
  }

  /** Applies the rating update once when a bot game ends. Returns the outcome shown in the dialog. */
  settleRating(res) {
    if (this.mode !== 'bot') return null;
    if (this.ratingMeta.recorded) return this.ratingOutcome;
    const st = this.ratingStatus({ reason: res.reason, plies: this.game.moves.length });
    if (!st.rated) { this.ratingOutcome = { rated: false, text: st.text, code: st.code }; return this.ratingOutcome; }
    try {
      const level = difficulty(this.botLevel);
      const u = mods.storage.recordRatedGame({ botLevel: level.id, opponent: level.elo, score: playerScore(res.result, this.playerColor) });
      this.ratingMeta.recorded = true;
      this.ratingOutcome = { rated: true, before: u.before, after: u.after, delta: u.delta, games: u.games };
    } catch (err) {
      console.warn('[rating]', err.message);
      this.ratingOutcome = { rated: false, text: 'The rating could not be updated because the result could not be stored on this device.' };
    }
    return this.ratingOutcome;
  }

  // Board orientation. The Perspective control chooses Auto, White or Black.
  // Auto: bot games face the player's colour; two-player games with the flip
  // setting on face the live side to move (play, Undo and Redo only — never
  // history navigation); analysis and other views default to White. White and
  // Black lock the board. A manual Flip inverts Auto, or switches White/Black.
  desiredOrientation() {
    const perspective = settings().boardPerspective || 'auto';
    if (perspective === 'w' || perspective === 'b') return perspective;
    let base;
    if (this.mode === 'bot') base = this.playerColor;
    else if (this.mode === 'local' && this.autoRotate) base = this.game.position.turn;
    else base = this.orientation || 'w';
    return this.flipped ? (base === 'w' ? 'b' : 'w') : base;
  }

  syncOrientation() {
    if (!this.board) return;
    const o = this.desiredOrientation();
    if (o !== this.board.opts.orientation) this.board.setOptions({ orientation: o });
  }

  // ------------------------------------------------------------ view
  mount(host) {
    // A fresh element per mount so listeners never outlive this controller.
    host.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'game-root';
    host.appendChild(root);
    this.root = root;
    const s = settings();
    const analysis = this.mode === 'analysis';
    root.innerHTML = `
    <div class="game-layout mode-${this.mode}">
      <div class="board-col">
        <div class="player-bar" data-slot="top"></div>
        <div class="board-row-wrap">
          <div class="evalbar ${s.showEval || analysis ? '' : 'hidden'}" role="img" aria-label="Evaluation bar"><div class="evalbar-fill"></div><span class="evalbar-text"></span></div>
          <div class="board-host"></div>
        </div>
        <div class="player-bar" data-slot="bottom"></div>
      </div>
      <aside class="side-col">
        <div class="frame panel"><span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>
          <div class="frame-inner">
            <p class="status" role="status" aria-live="polite"></p>
            ${this.mode === 'bot' ? '<p class="rating-note" aria-live="polite"></p>' : ''}
            <p class="thinking hidden" aria-hidden="true"><span class="spinner"></span><span>The bot is calculating its move.</span></p>
            <div class="history-note hidden"><p>You are viewing an earlier position. Select the last move or press End to return to the current position.</p></div>
            <div class="controls" role="toolbar" aria-label="Game controls"></div>
            <div class="perspective-ctrl">
              <p class="persp-label" id="persp-label">Board perspective</p>
              <div class="choice-row persp-choices" role="radiogroup" aria-labelledby="persp-label">
                <label class="choice"><input type="radio" name="board-perspective" value="auto"><span>Auto</span></label>
                <label class="choice"><input type="radio" name="board-perspective" value="w"><span>White</span></label>
                <label class="choice"><input type="radio" name="board-perspective" value="b"><span>Black</span></label>
              </div>
              <p class="help">Auto follows the rules for this mode. White and Black lock the board to that side.</p>
            </div>
            ${DIVIDER}
            <section class="opening-banner" aria-label="Opening">
              <span class="ob-orn" aria-hidden="true"></span>
              <div class="ob-body" aria-live="polite" aria-atomic="true">
                <p class="ob-head"><abbr class="ob-eco" title="Encyclopaedia of Chess Openings code"></abbr><span class="ob-name"></span></p>
                <p class="ob-note"></p>
              </div>
              <span class="ob-orn" aria-hidden="true"></span>
            </section>
            <h3 class="engraved small">Moves</h3>
            <div class="movelist" tabindex="0" role="region" aria-label="Move list"></div>
            <div class="navbtns" role="group" aria-label="Move navigation">
              <button class="btn icon-only" data-act="first" type="button" aria-label="First position" title="First position (Home)">${ICONS.first}</button>
              <button class="btn icon-only" data-act="prev" type="button" aria-label="Previous move" title="Previous move (Left arrow)">${ICONS.prev}</button>
              <button class="btn icon-only" data-act="next" type="button" aria-label="Next move" title="Next move (Right arrow)">${ICONS.next}</button>
              <button class="btn icon-only" data-act="last" type="button" aria-label="Last position" title="Last position (End)">${ICONS.last}</button>
            </div>
            ${analysis ? `${DIVIDER}<h3 class="engraved small">Engine lines</h3><div class="engine-lines" aria-live="polite"><p class="muted">The engine evaluates the position shown on the board.</p></div>` : ''}
          </div>
        </div>
      </aside>
    </div>`;
    const orientation = this.desiredOrientation();
    this.board = new Board(root.querySelector('.board-host'), {
      pieceSet: s.pieceSet, orientation, showLegal: s.showLegal, showCoords: s.showCoords, animations: s.animations, autoQueen: s.autoQueen,
      label: 'Chess board. Use the arrow keys to move between squares and Enter to select a piece or a destination.',
      onMove: (m) => this.userMove(m),
    });
    this.renderControls();
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t && t.name === 'board-perspective') this.setPerspective(t.value);
    });
    this.unsubSettings = onSettings((st) => {
      this.board.setOptions({ pieceSet: st.pieceSet, showLegal: st.showLegal, showCoords: st.showCoords, animations: st.animations, autoQueen: st.autoQueen });
      const eb = root.querySelector('.evalbar'); if (eb) eb.classList.toggle('hidden', !(st.showEval || analysis));
      this.render();
    });
    this.unsubBusy = bot.onBusy(() => this.renderThinking());
    this.board.setPosition(this.position, { lastMove: this.game.moves[this.viewPly - 1] || null });
    this.render();
    if (this.clock && !this.over && this.game.moves.length && !this.clock.running) this.clock.start(this.game.position.turn);
    this.maybeBotMove();
    this.refreshEval();
  }

  unmount() {
    if (this.clock) this.clock.stop();
    if (this.unsubSettings) this.unsubSettings();
    if (this.unsubBusy) this.unsubBusy();
    this.root = null;
  }

  destroy() {
    this.thinkToken++;
    bot.cancel();
    if (this.clock) this.clock.stop();
    this.unmount();
  }

  renderControls() {
    const c = this.root.querySelector('.controls');
    const btn = (act, icon, label, extra = '') => `<button class="btn" type="button" data-act="${act}" ${extra}>${ICONS[icon]}<span>${label}</span></button>`;
    let html = '';
    if (this.mode === 'bot') {
      html = btn('new', 'play', 'New game') + btn('undo', 'undo', 'Undo') + (settings().hints !== false ? btn('hint', 'hint', 'Hint') : '') + btn('flip', 'flip', 'Flip board')
        + btn('draw', 'handshake', 'Offer a draw') + btn('resign', 'flag', 'Resign') + btn('save', 'save', 'Save game') + btn('analyse', 'next', 'Analyse') + btn('review', 'play', 'Review');
    } else if (this.mode === 'local') {
      html = btn('new', 'play', 'New game') + btn('undo', 'undo', 'Undo') + btn('redo', 'redo', 'Redo') + btn('flip', 'flip', 'Flip board')
        + btn('draw', 'handshake', 'Agree a draw') + btn('resign', 'flag', 'Resign') + btn('save', 'save', 'Save game') + btn('analyse', 'next', 'Analyse') + btn('review', 'play', 'Review');
    } else {
      html = btn('undo', 'undo', 'Take back') + btn('flip', 'flip', 'Flip board') + btn('save', 'save', 'Save game') + btn('pgn', 'copy', 'Copy PGN') + btn('pgnfile', 'download', 'Download PGN');
    }
    c.innerHTML = html;
  }

  playerName(color) {
    if (this.mode === 'bot') {
      if (color === this.playerColor) return 'You';
      const d = difficulty(this.botLevel);
      return `Bot: ${d.name}${d.elo ? ` (about ${d.elo})` : ''}`;
    }
    return color === 'w' ? 'White' : 'Black';
  }

  render() {
    if (!this.root) return;
    this.syncOrientation();
    this.syncPerspectiveRadios();
    const s = settings();
    const pos = this.position;
    const live = this.game.position;
    const result = this.game.result();
    // player bars
    const bottomColor = this.board.opts.orientation;
    const topColor = bottomColor === 'w' ? 'b' : 'w';
    const mat = materialInfo(pos);
    for (const [slot, color] of [['top', topColor], ['bottom', bottomColor]]) {
      const bar = this.root.querySelector(`.player-bar[data-slot="${slot}"]`);
      const caps = mat.captured[color].map((t) => `<span class="cap cap-${color === 'w' ? 'b' : 'w'}">${pieceSvg(s.pieceSet, color === 'w' ? 'b' : 'w', t)}</span>`).join('');
      const adv = color === 'w' ? mat.diff : -mat.diff;
      const turn = !result && live.turn === color;
      bar.className = `player-bar ${turn ? 'to-move' : ''}`;
      bar.dataset.slot = slot;
      bar.innerHTML = `<span class="pb-dot ${color}" aria-hidden="true"></span><span class="pb-name">${esc(this.playerName(color))}</span>
        <span class="pb-caps" aria-label="Pieces captured by ${color === 'w' ? 'White' : 'Black'}: ${mat.captured[color].length}">${caps}${adv > 0 ? `<span class="pb-adv">+${adv}</span>` : ''}</span>
        ${this.clock ? `<span class="pb-clock" data-clock="${color}" role="timer" aria-label="${color === 'w' ? 'White' : 'Black'} clock"></span>` : ''}`;
    }
    this.renderClocks();
    // status
    let status;
    if (result) status = describeResult(result);
    else if (this.mode === 'bot' && live.turn === this.botColor) status = live.inCheck() ? 'The bot is in check and is choosing a move.' : 'The bot is choosing a move.';
    else {
      const side = live.turn === 'w' ? 'White' : 'Black';
      const who = this.mode === 'bot' ? 'It is your move' : `${side} is to move`;
      status = live.inCheck() ? `${who}, and ${this.mode === 'bot' ? 'your' : side === 'White' ? "White's" : "Black's"} king is in check.` : `${who}.`;
    }
    this.root.querySelector('.status').textContent = status;
    const rn = this.root.querySelector('.rating-note');
    if (rn) { const t = this.ratingNoteText(); if (rn.textContent !== t) rn.textContent = t; rn.classList.toggle('is-rated', this.ratingMeta.recorded || (!this.ratingOutcome && this.ratingStatus().rated)); }
    this.root.querySelector('.history-note').classList.toggle('hidden', this.atEnd);
    this.renderOpening();
    this.renderMoves();
    this.renderThinking();
    this.updateMovable();
    this.updateButtons();
    this.renderEval();
  }

  renderClocks() {
    if (!this.root || !this.clock) return;
    for (const c of ['w', 'b']) {
      const e = this.root.querySelector(`[data-clock="${c}"]`); if (!e) continue;
      const ms = this.clock.now(c);
      e.textContent = formatClock(ms);
      e.classList.toggle('running', this.clock.running === c);
      e.classList.toggle('low', ms < 20e3);
    }
  }

  renderThinking() {
    if (!this.root) return;
    const on = this.mode === 'bot' && bot.busy && !this.over;
    const t = this.root.querySelector('.thinking'); if (t) t.classList.toggle('hidden', !on);
  }

  // Opening for the position shown on the board (the viewed ply, not only the latest).
  opening(ply = this.viewPly) {
    const o = mods.openings;
    if (!o || !o.identifyOpeningForGame) return null;
    try { return o.identifyOpeningForGame(this.game, { ply }); } catch (err) { console.warn('[openings]', err.message); return null; }
  }

  renderOpening() {
    const box = this.root && this.root.querySelector('.opening-banner'); if (!box) return;
    if (!mods.openings) { box.classList.add('hidden'); return; }
    const ply = this.viewPly;
    const custom = this.game.positions[0].toFen() !== mods.engine.START_FEN;
    const r = custom ? null : this.opening(ply);
    let eco = '', name = '', note = '';
    if (custom) note = 'Opening names are not shown for games that start from a custom position.';
    else if (ply === 0) note = 'No moves have been played yet. The opening is named after the first move.';
    else if (!r) note = 'No named opening matches the moves played so far.';
    else {
      eco = r.eco; name = r.name;
      const parts = [];
      if (r.matchedBy === 'transposition') parts.push('This position was reached by a different move order.');
      if (r.lastBookPly < ply) {
        const mv = Math.ceil(r.lastBookPly / 2), side = r.lastBookPly % 2 ? 'White' : 'Black';
        parts.push(`The game left the known opening lines after ${side}'s move ${mv}.`);
      }
      note = parts.join(' ');
    }
    const key = `${eco}|${name}|${note}`;
    box.classList.toggle('no-match', !eco);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.dataset.eco = eco;
    const ecoEl = box.querySelector('.ob-eco'), nameEl = box.querySelector('.ob-name'), noteEl = box.querySelector('.ob-note');
    ecoEl.textContent = eco; ecoEl.hidden = !eco;
    nameEl.textContent = name; nameEl.hidden = !name;
    noteEl.textContent = note; noteEl.hidden = !note;
  }

  renderMoves() {
    const list = this.root.querySelector('.movelist');
    const sans = this.game.sans;
    const start = this.game.positions[0];
    const blackFirst = start.turn === 'b';
    let html = '<ol class="moves">';
    let num = start.fullmove;
    let i = 0;
    const cell = (idx) => `<button type="button" class="mv ${idx + 1 === this.viewPly ? 'current' : ''}" data-ply="${idx + 1}" aria-label="Move ${Math.floor((idx + (blackFirst ? 1 : 0)) / 2) + start.fullmove}, ${((idx + (blackFirst ? 1 : 0)) % 2) ? 'Black' : 'White'}: ${esc(sans[idx])}">${esc(sans[idx])}</button>`;
    if (blackFirst && sans.length) { html += `<li><span class="mvn">${num}.</span><span class="mv empty">…</span>${cell(0)}</li>`; i = 1; num++; }
    for (; i < sans.length; i += 2, num++) html += `<li><span class="mvn">${num}.</span>${cell(i)}${i + 1 < sans.length ? cell(i + 1) : ''}</li>`;
    html += '</ol>';
    const res = this.game.result();
    if (res) html += `<p class="result-tag">${esc(res.result)}</p>`;
    if (!sans.length) html = '<p class="muted">No moves have been played yet.</p>';
    list.innerHTML = html;
    const cur = list.querySelector('.mv.current');
    if (cur) { const lr = list.getBoundingClientRect(), cr = cur.getBoundingClientRect(); if (cr.bottom > lr.bottom || cr.top < lr.top) list.scrollTop += cr.top - lr.top - lr.height / 2; }
  }

  updateMovable() {
    let m = null;
    if (!this.game.result() && !this.over && this.atEnd) {
      if (this.mode === 'bot') m = this.game.position.turn === this.playerColor && !bot.busy ? this.playerColor : null;
      else m = 'both';
    }
    if (this.mode === 'analysis') m = 'both';
    this.board.setMovable(m);
  }

  updateButtons() {
    const set = (act, disabled, reason) => {
      const b = this.root.querySelector(`[data-act="${act}"]`); if (!b) return;
      b.disabled = !!disabled; if (reason) b.title = reason; else b.removeAttribute('title');
    };
    const over = !!this.game.result();
    const n = this.game.moves.length;
    set('undo', n === 0 || (this.mode !== 'analysis' && over && this.mode !== 'local'), n === 0 ? 'There are no moves to undo.' : '');
    set('redo', !this.game.canRedo || !this.game.canRedo(), 'There is no undone move to redo.');
    set('hint', over || this.game.position.turn !== this.playerColor || !this.atEnd, 'A hint is available on your move.');
    set('draw', over || n < 2, over ? 'The game has ended.' : 'A draw can be offered after the first moves.');
    set('resign', over, 'The game has ended.');
    set('review', !over || this.game.moves.length === 0, over ? 'Review the moves of this game with the engine.' : 'A review is available after the game ends.');
    set('first', this.viewPly === 0); set('prev', this.viewPly === 0);
    set('next', this.atEnd); set('last', this.atEnd);
  }

  // ------------------------------------------------------------ evaluation
  renderEval() {
    const bar = this.root && this.root.querySelector('.evalbar'); if (!bar) return;
    const fill = bar.querySelector('.evalbar-fill'), txt = bar.querySelector('.evalbar-text');
    const sc = this.evalScore;
    if (sc == null) { fill.style.transform = 'scaleY(.5)'; txt.textContent = ''; bar.setAttribute('aria-label', 'The evaluation is not available yet.'); return; }
    const mate = Math.abs(sc) > 20000;
    const clamped = mate ? Math.sign(sc) * 1000 : Math.max(-1000, Math.min(1000, sc));
    const pctWhite = 50 + 50 * (2 / (1 + Math.exp(-clamped / 250)) - 1);
    const whiteOnBottom = this.board.opts.orientation === 'w';
    fill.style.transform = `scaleY(${((whiteOnBottom ? pctWhite : 100 - pctWhite) / 100).toFixed(4)})`;
    bar.classList.toggle('flipped', !whiteOnBottom);
    const label = mate ? (sc > 0 ? 'White has a forced mate.' : 'Black has a forced mate.') : `The evaluation is ${formatScore(sc)} from White's point of view.`;
    txt.textContent = mate ? 'M' : formatScore(sc);
    bar.setAttribute('aria-label', label);
  }

  async refreshEval() {
    const analysis = this.mode === 'analysis';
    if (!this.root || !(settings().showEval || analysis)) return;
    const pos = this.position; const token = (this.evalToken = (this.evalToken || 0) + 1);
    if (pos.legalMoves().length === 0) {
      this.evalScore = pos.isCheckmate() ? (pos.turn === 'w' ? -30000 : 30000) : 0;
      this.renderEval(); if (analysis) this.renderLines([]); return;
    }
    evalClient.cancel();
    try {
      const lines = await evalClient.analyze(pos, analysis ? { timeMs: 900, multiPv: 3 } : { timeMs: 350, multiPv: 1 });
      if (token !== this.evalToken || !lines.length) return;
      const s = lines[0].score; this.evalScore = pos.turn === 'w' ? s : -s;
      this.analysisLines = lines;
      this.renderEval();
      if (analysis) this.renderLines(lines);
    } catch (err) { if (!err.cancelled) console.warn('[eval]', err.message); }
  }

  renderLines(lines) {
    const box = this.root && this.root.querySelector('.engine-lines'); if (!box) return;
    const pos = this.position;
    if (!lines.length) { box.innerHTML = `<p class="muted">${pos.isCheckmate() ? 'The position is checkmate.' : 'The position has no legal moves.'}</p>`; return; }
    const { Position } = mods.engine;
    box.innerHTML = '<ol class="lines">' + lines.map((l, i) => {
      const white = pos.turn === 'w' ? l.score : -l.score;
      let p = pos; const sans = [];
      for (const u of (l.pvUci && l.pvUci.length ? l.pvUci : [pos.moveToUci(l.move)]).slice(0, 8)) {
        const m = p.parseUci(u); if (!m) break; sans.push(p.toSan(m)); p = p.makeMove(m);
      }
      void Position;
      const sc = Math.abs(white) > 20000 ? (white > 0 ? 'White mates' : 'Black mates') : formatScore(white);
      return `<li><button type="button" class="line-btn" data-line="${i}"><span class="line-score">${esc(sc)}</span> <span class="line-pv">${esc(sans.join(' '))}</span></button></li>`;
    }).join('') + '</ol>';
  }

  // ------------------------------------------------------------ actions
  onClick(e) {
    const mv = e.target.closest('.mv[data-ply]');
    if (mv) { this.goto(+mv.dataset.ply); return; }
    const line = e.target.closest('.line-btn');
    if (line) { const l = this.analysisLines[+line.dataset.line]; if (l && l.move) this.userMove(l.move); return; }
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act;
    const fn = {
      first: () => this.goto(0), prev: () => this.goto(this.viewPly - 1), next: () => this.goto(this.viewPly + 1), last: () => this.goto(this.game.moves.length),
      flip: () => this.flip(), undo: () => this.undo(), redo: () => this.redo(), hint: () => this.hint(), resign: () => this.resign(), draw: () => this.offerDraw(),
      save: () => this.saveAs(), new: () => this.requestNewGame(), analyse: () => this.onAnalyse && this.onAnalyse(this.record()),
      review: () => this.onReview && this.onReview(this.record()),
      pgn: () => this.copyPgn(), pgnfile: () => this.downloadPgn(),
    }[act];
    if (fn) fn();
  }

  goto(ply) {
    ply = Math.max(0, Math.min(this.game.moves.length, ply));
    if (ply === this.viewPly) return;
    const forward = ply === this.viewPly + 1;
    this.viewPly = ply;
    this.board.setArrows([]);
    this.board.setPosition(this.position, { lastMove: this.game.moves[ply - 1] || null, animate: forward });
    if (forward && settings().sound) sfx(soundForMove(this.game.moves[ply - 1], this.position));
    this.render();
    this.refreshEval();
  }

  flip() {
    const perspective = settings().boardPerspective || 'auto';
    if (perspective === 'w' || perspective === 'b') {
      this.flipped = false;
      updateSettings({ boardPerspective: perspective === 'w' ? 'b' : 'w' });
    } else {
      this.flipped = !this.flipped;
    }
    this.render();
  }

  setPerspective(value) {
    const v = value === 'w' || value === 'b' ? value : 'auto';
    this.flipped = false;
    updateSettings({ boardPerspective: v });
    this.render();
  }

  syncPerspectiveRadios() {
    if (!this.root) return;
    const cur = settings().boardPerspective || 'auto';
    for (const input of this.root.querySelectorAll('input[name="board-perspective"]')) {
      input.checked = input.value === cur;
    }
    const flipBtn = this.root.querySelector('[data-act="flip"]');
    if (flipBtn) {
      const forced = cur === 'w' || cur === 'b';
      if (forced) flipBtn.removeAttribute('aria-pressed');
      else flipBtn.setAttribute('aria-pressed', this.flipped ? 'true' : 'false');
    }
  }

  // Two-player games only: replay a move that was taken back with Undo.
  redo() {
    if (this.mode !== 'local' || !this.game.canRedo || !this.game.canRedo()) return;
    this.game.redo();
    this.viewPly = this.game.moves.length;
    const played = this.game.moves[this.viewPly - 1];
    this.board.setArrows([]);
    this.board.setPosition(this.position, { lastMove: played, animate: true });
    if (settings().sound) sfx(soundForMove(played, this.position));
    if (this.clock && !this.game.result()) { this.clock.stop(); this.clock.start(this.game.position.turn); }
    this.afterChange();
  }

  userMove(move) {
    if (this.mode === 'analysis' && !this.atEnd) {
      // Branch from the viewed position: keep moves up to the view, then play.
      const { Game } = mods.engine;
      const json = this.game.toJSON();
      const g = Game.fromJSON({ version: 1, startFen: json.startFen, uci: json.uci.slice(0, this.viewPly), resultInfo: null });
      this.game = g;
    }
    if (!this.atEnd) return;
    if (this.mode === 'bot' && this.game.position.turn !== this.playerColor) return;
    this.applyMove(move, true);
  }

  applyMove(move, byUser) {
    const mover = this.game.position.turn;
    if (!this.game.play(move)) { if (settings().sound) sfx('illegal'); toast('That move is not legal in this position.'); this.board.setPosition(this.position, { lastMove: this.game.moves[this.viewPly - 1] || null }); return false; }
    this.viewPly = this.game.moves.length;
    const played = this.game.moves[this.viewPly - 1];
    this.board.setArrows([]);
    this.board.setPosition(this.position, { lastMove: played, animate: !byUser || true });
    if (settings().sound) sfx(soundForMove(played, this.position));
    if (this.clock && !this.game.result()) this.clock.switchAfterMove(mover);
    this.afterChange();
    this.maybeBotMove();
    return true;
  }

  afterChange() {
    this.render();
    this.autosave();
    this.checkEnd();
    this.refreshEval();
    if (this.onChange) this.onChange(this);
  }

  autosave() {
    if (this.mode === 'analysis') return;
    if (this.game.result()) { mods.storage.clearAutosave(); return; }
    try { mods.storage.saveAutosave(this.record()); } catch (err) { console.warn('[autosave]', err.message); }
  }

  record() {
    return {
      ...(this.savedId ? { id: this.savedId } : {}),
      name: this.name || this.defaultName(), savedAt: Date.now(), mode: this.mode,
      ...(this.mode === 'bot' ? { botLevel: this.botLevel, playerColor: this.playerColor } : {}),
      game: this.game.toJSON(),
      ...(this.clock ? { clock: this.clock.snapshot() } : {}),
      ...(this.mode === 'bot' ? { rating: { ...this.ratingMeta } } : {}),
    };
  }

  defaultName() {
    const d = new Date().toLocaleDateString(undefined, { dateStyle: 'medium' });
    if (this.mode === 'bot') return `Game against ${difficulty(this.botLevel).name} on ${d}`;
    if (this.mode === 'local') return `Two-player game on ${d}`;
    return `Analysis on ${d}`;
  }

  async checkEnd() {
    const res = this.game.result();
    if (!res || this.reported) return;
    this.reported = true; this.over = true;
    this.thinkToken++; bot.cancel();
    if (this.clock) this.clock.stop();
    this.render();
    if (this.mode === 'analysis') return;
    if (settings().sound) sfx('end');
    try { mods.storage.recordResult({ mode: this.mode, botLevel: this.mode === 'bot' ? this.botLevel : undefined, playerColor: this.mode === 'bot' ? this.playerColor : 'w', result: res.result, opening: this.opening() }); } catch (err) { console.warn('[stats]', err.message); }
    const ratingOutcome = this.settleRating(res);
    this.render();
    mods.storage.clearAutosave();
    let title = 'The game is over';
    if (this.mode === 'bot') {
      if (res.result === '1/2-1/2') title = 'The game is drawn';
      else title = (res.result === '1-0') === (this.playerColor === 'w') ? 'You won the game' : 'The bot won the game';
    }
    await new Promise((r) => setTimeout(r, 350));
    if (!this.root) return;
    const v = await gameOverDialog(title, describeResult(res), [
      { value: 'new', label: 'Start a new game' }, { value: 'save', label: 'Save this game' }, { value: 'analyse', label: 'Analyse this game' }, { value: 'review', label: 'Review this game' }, { value: 'close', label: 'Close' },
    ], { extraHtml: ratingChangeHtml(ratingOutcome) });
    if (v === 'new' && this.onNewGame) this.onNewGame();
    if (v === 'save') this.saveAs();
    if (v === 'analyse' && this.onAnalyse) this.onAnalyse(this.record());
    if (v === 'review' && this.onReview) this.onReview(this.record());
  }

  flag(color) {
    if (this.game.result()) return;
    this.game.timeout(color);
    this.afterChange();
  }

  maybeBotMove() {
    if (this.mode !== 'bot' || !this.root) return;
    if (this.game.result() || this.over) return;
    if (this.game.position.turn !== this.botColor) return;
    const token = ++this.thinkToken;
    const pos = this.game.position;
    const level = difficulty(this.botLevel);
    const started = performance.now();
    this.render();
    bot.choose(pos, this.game.positions.slice(0, -1), { difficultyId: level.id }).then(async (res) => {
      const wait = 350 - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (token !== this.thinkToken || this.game.position !== pos) return;
      if (!res.move) { console.warn('[bot] no move returned'); return; }
      this.applyMove(res.move, false);
    }).catch((err) => {
      if (err.cancelled) return;
      console.error('[bot]', err.message);
      toast('The bot could not choose a move. Select Undo or start a new game.');
      this.render();
    });
  }

  async undo() {
    if (!this.game.moves.length) return;
    if (this.mode === 'bot') {
      // Nothing to take back until the player has made a move.
      if (!this.game.positions.slice(0, this.game.moves.length).some((p) => p.turn === this.playerColor)) return;
      if (this.wouldLoseRating()) {
        const ok = await confirmDialog('Take back a move', 'This game is rated. Taking back a move makes it unrated, and the result will not change your rating. Do you want to take back the move?', { ok: 'Take back and play unrated' });
        if (!ok || !this.root) return;
      }
      if (!this.ratingMeta.recorded) { this.ratingMeta.usedUndo = true; this.ratingOutcome = null; }
      else if (this.game.result()) this.ratingOutcome = { rated: false, text: 'The result of this game has already been counted, so moves played after Undo do not change your rating.' };
    }
    this.thinkToken++;
    bot.cancel();
    const over = !!this.game.result();
    if (this.mode === 'bot') {
      // Undo the bot reply and the player's move so that it is the player's turn again.
      this.game.undo();
      if (this.game.position.turn !== this.playerColor && this.game.moves.length) this.game.undo();
    } else this.game.undo();
    if (over) { this.over = false; this.reported = false; }
    this.viewPly = this.game.moves.length;
    this.board.setArrows([]);
    this.board.setPosition(this.position, { lastMove: this.game.moves[this.viewPly - 1] || null });
    if (this.clock && !this.game.result()) { this.clock.stop(); this.clock.start(this.game.position.turn); }
    this.render(); this.autosave(); this.refreshEval();
    this.maybeBotMove();
  }

  async hint() {
    if (this.game.result() || !this.atEnd) return;
    if (this.mode === 'bot' && this.wouldLoseRating()) {
      const ok = await confirmDialog('Use a hint', 'This game is rated. Using a hint makes it unrated, and the result will not change your rating. Do you want to see a hint?', { ok: 'Show a hint and play unrated' });
      if (!ok || !this.root || this.game.result()) return;
    }
    if (this.mode === 'bot') { this.ratingMeta.usedHint = true; this.render(); this.autosave(); }
    const pos = this.game.position;
    const b = this.root.querySelector('[data-act="hint"]'); if (b) b.disabled = true;
    try {
      const lines = await evalClient.analyze(pos, { timeMs: 900, multiPv: 1 });
      if (this.game.position !== pos || !lines.length) return;
      const m = lines[0].move;
      this.board.setHint([m.from]);
      this.board.setArrows([{ from: m.from, to: m.to, kind: 'hint', piece: m.piece }]);
      this.root.querySelector('.status').textContent = `The suggested move is ${pos.toSan(m)}, from ${sqName(m.from)} to ${sqName(m.to)}.`;
    } catch (err) { if (!err.cancelled) toast('A hint could not be calculated.'); }
    finally { this.updateButtons(); }
  }

  async resign() {
    if (this.game.result()) return;
    const color = this.mode === 'bot' ? this.playerColor : this.game.position.turn;
    const ok = await confirmDialog('Resign the game', `${this.mode === 'bot' ? 'You will lose this game.' : `${color === 'w' ? 'White' : 'Black'} will lose this game.`} Do you want to resign?`, { ok: 'Resign', danger: true });
    if (!ok) return;
    this.thinkToken++; bot.cancel();
    this.game.resign(color);
    this.afterChange();
  }

  async offerDraw() {
    if (this.game.result()) return;
    if (this.mode === 'local') {
      const ok = await confirmDialog('Agree a draw', 'Both players agree to end the game as a draw. Do you want to record a draw?', { ok: 'Record a draw' });
      if (ok) { this.game.drawByAgreement(); this.afterChange(); }
      return;
    }
    if (this.game.moves.length - this.drawOfferedAt < 6) { toast('The bot has already declined a recent draw offer. Play a few more moves before offering again.'); return; }
    this.drawOfferedAt = this.game.moves.length;
    toast('The bot is considering the draw offer.');
    try {
      const pos = this.game.position;
      const lines = await evalClient.analyze(pos, { timeMs: 700, multiPv: 1 });
      if (!lines.length || this.game.position !== pos) return;
      const botScore = pos.turn === this.botColor ? lines[0].score : -lines[0].score;
      if (botScore <= -200) {
        this.thinkToken++; bot.cancel();
        this.game.drawByAgreement();
        this.afterChange();
      } else toast('The bot declined the draw offer because its position is not clearly worse.');
    } catch (err) { if (!err.cancelled) toast('The draw offer could not be evaluated.'); }
  }

  async saveAs() {
    const name = await promptDialog('Save the game', 'Enter a name for this game.', this.name || this.defaultName());
    if (name == null) return;
    this.name = name.trim() || this.defaultName();
    try {
      this.savedId = mods.storage.saveGame(this.record());
      toast(`The game was saved as "${this.name}".`);
    } catch (err) { toast(`The game could not be saved: ${err.message}`); }
  }

  pgn() {
    const o = this.opening(this.game.moves.length);
    return this.game.toPgn({ Event: this.name || this.defaultName(), White: this.playerName('w'), Black: this.playerName('b'), Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), ...(o ? { ECO: o.eco, Opening: o.name } : {}) });
  }
  async copyPgn() { toast((await copyText(this.pgn())) ? 'The PGN was copied to the clipboard.' : 'The PGN could not be copied.'); }
  downloadPgn() { download(safeFileName(this.name || this.defaultName()) + '.pgn', this.pgn(), 'application/x-chess-pgn'); }

  // Keyboard shortcuts handled by the page.
  handleKey(e) {
    const k = e.key;
    if (k === 'ArrowLeft') this.goto(this.viewPly - 1);
    else if (k === 'ArrowRight') this.goto(this.viewPly + 1);
    else if (k === 'Home' || k === 'ArrowUp') this.goto(0);
    else if (k === 'End' || k === 'ArrowDown') this.goto(this.game.moves.length);
    else if (k === 'f' || k === 'F') this.flip();
    else if (k === 'u' || k === 'U') this.undo();
    else if ((k === 'h' || k === 'H') && this.mode === 'bot') this.hint();
    else return false;
    return true;
  }
}
