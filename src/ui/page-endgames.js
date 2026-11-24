// Endgame practice (#/endgames and #/endgames/<id>): a catalog of essential
// positions, played out against the bundled Stockfish engine.
import { mods } from './modules.js';
import { settings, onSettings } from './state.js';
import { Board } from './board.js';
import { esc } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { play as sfx, soundForMove } from './sound.js';
import { StockfishEngine } from './stockfish-client.js';
import { ENDGAMES, ENDGAME_CATEGORIES, endgameById, EndgameSession, ideaLine, reasonText } from '../endgames.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const SIDE = { w: 'White', b: 'Black' };
const ENGINE_DEPTH = 14;

let cleanup = [];
let viewer = null;
let engine = null;

function progress() {
  try { return mods.storage.getEndgameProgress ? mods.storage.getEndgameProgress() : { positions: {} }; } catch { return { positions: {} }; }
}

function mark(id, info) {
  try { if (mods.storage.markEndgame) mods.storage.markEndgame(id, info); } catch (err) { console.warn('[endgames]', err.message); }
}

function completedCount() {
  const rec = progress().positions || {};
  return ENDGAMES.filter((e) => rec[e.id] && rec[e.id].completed).length;
}

export function render(root, { rest }) {
  cleanup.forEach((f) => f()); cleanup = [];
  if (rest && rest[0]) return renderPlay(root, decodeURIComponent(rest[0]));
  return renderList(root);
}

function renderList(root) {
  const rec = progress().positions || {};
  const done = completedCount();
  root.innerHTML = `
    <h1 class="page-title" id="title-endgames">Endgame practice</h1>
    <p class="lede">These positions are essential endings that repay careful study: the basic checkmates, several king and pawn techniques, the Lucena, Philidor and Vancura rook endings, and a few queen and minor-piece positions. You play them against the engine that is bundled with this application. You have completed ${done} of ${ENDGAMES.length} positions.</p>
    <div class="eg-groups"></div>`;
  const groups = root.querySelector('.eg-groups');
  groups.innerHTML = ENDGAME_CATEGORIES.map((c) => {
    const items = ENDGAMES.filter((e) => e.category === c.id);
    const n = items.filter((e) => rec[e.id] && rec[e.id].completed).length;
    return `<section class="eg-group" aria-labelledby="egg-${c.id}">
      <h2 id="egg-${c.id}" class="eg-group-title">${esc(c.name)}</h2>
      <p class="muted eg-group-text">${esc(c.text)} You have completed ${n} of ${items.length} in this group.</p>
      <ul class="eg-grid">${items.map((e) => {
        const st = rec[e.id];
        const status = st && st.completed ? 'Completed' : st && st.attempts ? 'Attempted' : 'Not attempted';
        return `<li><a class="eg-card ${st && st.completed ? 'completed' : ''}" href="#/endgames/${encodeURIComponent(e.id)}">
          <span class="eg-card-title">${esc(e.title)}</span>
          <span class="eg-card-goal">${esc(e.goalText)}</span>
          <span class="eg-card-status">${status}</span></a></li>`;
      }).join('')}</ul>
    </section>`;
  }).join('');
  return () => { cleanup.forEach((f) => f()); cleanup = []; };
}

function renderPlay(root, id) {
  const entry = endgameById(id);
  if (!entry) {
    root.innerHTML = `<h1 class="page-title" id="title-endgames">The position was not found</h1><p class="lede">No endgame practice position has the identifier "${esc(id)}". <a href="#/endgames">Return to the endgame list.</a></p>`;
    return;
  }
  const session = new EndgameSession(entry);
  const s = settings();
  const state = { busy: false, hintStage: 0, ideaShown: false, lastMove: null };
  const side = SIDE[entry.playerColor];
  const opp = SIDE[entry.playerColor === 'w' ? 'b' : 'w'];
  root.innerHTML = `
    <p class="eg-back"><a href="#/endgames">${ICONS.prev}<span>All endgame positions</span></a></p>
    <h1 class="page-title" id="title-endgames">${esc(entry.title)}</h1>
    <p class="lede">${esc(side)} plays ${entry.goal === 'win' ? 'to win' : 'to hold the draw'}. ${esc(entry.goalText)}</p>
    <div class="game-layout mode-endgame">
      <div class="board-col"><div class="board-row-wrap"><div class="board-host"></div></div></div>
      <aside class="side-col"><div class="frame panel">${fc}<div class="frame-inner">
        <p class="status eg-status" role="status" aria-live="polite"></p>
        <div class="controls" role="toolbar" aria-label="Endgame controls">
          <button class="btn" type="button" data-act="hint">${ICONS.hint}<span>Hint</span></button>
          <button class="btn" type="button" data-act="idea">${ICONS.next}<span>Show the idea</span></button>
          <button class="btn" type="button" data-act="retry">${ICONS.retry}<span>Retry</span></button>
          <button class="btn" type="button" data-act="flip">${ICONS.flip}<span>Flip board</span></button>
        </div>
        ${DIVIDER}
        <div class="explanation"><h3 class="small">The position</h3><p class="eg-expl">${esc(entry.explanation)}</p></div>
        <div class="eg-idea hidden"><h3 class="small">The idea</h3><p class="eg-idea-text">${esc(entry.idea)}</p></div>
        <p class="eg-result hidden" role="status"></p>
        <div class="btn-row eg-after hidden">
          <button class="btn primary" type="button" data-act="retry">${ICONS.retry}<span>Retry this position</span></button>
          <a class="btn" href="#/endgames">Return to the list</a>
        </div>
      </div></div></aside>
    </div>`;

  const host = root.querySelector('.board-host');
  const board = new Board(host, { pieceSet: s.pieceSet, orientation: entry.playerColor, showLegal: s.showLegal, showCoords: s.showCoords, animations: s.animations, autoQueen: s.autoQueen, label: `${entry.title} board` });
  const offSettings = onSettings((ns) => board.setOptions({ pieceSet: ns.pieceSet, showLegal: ns.showLegal, showCoords: ns.showCoords, animations: ns.animations, autoQueen: ns.autoQueen }));
  cleanup.push(offSettings);

  function statusEl() { return root.querySelector('.eg-status'); }
  function setStatus(text) { const el = statusEl(); if (el) el.textContent = text; }

  function syncBoard(animate) {
    const last = session.game.lastMove || state.lastMove;
    board.setPosition(session.position, { lastMove: last, animate: !!animate });
    board.setMovable(state.busy || session.status !== 'in-progress' ? null : (session.playerToMove ? session.playerColor : null));
  }

  function finish() {
    const rec = { completed: session.status === 'success', attempts: 1, usedHint: session.usedHint };
    mark(entry.id, rec);
    const text = reasonText(session.reason, { goal: entry.goal, status: session.status });
    setStatus(text);
    const box = root.querySelector('.eg-result');
    if (box) { box.textContent = text; box.classList.remove('hidden'); box.classList.toggle('ok', session.status === 'success'); box.classList.toggle('fail', session.status === 'failure'); }
    root.querySelector('.eg-after')?.classList.remove('hidden');
    board.setMovable(null);
  }

  function startEngine() {
    if (!engine) engine = new StockfishEngine();
    return engine;
  }

  async function engineMove() {
    if (!session.engineToMove() || state.busy) return;
    state.busy = true;
    board.setMovable(null);
    setStatus(`The engine is choosing a move for ${opp}.`);
    try {
      const sf = startEngine();
      const lines = await sf.analyse(session.position.toFen(), { depth: ENGINE_DEPTH, multipv: 1 });
      if (!root.isConnected || session.status !== 'in-progress') { state.busy = false; return; }
      const uci = lines && lines[0] && lines[0].move;
      const move = uci ? session.position.parseUci(uci) : null;
      if (!move) { setStatus('The engine could not choose a move. You can retry this position.'); state.busy = false; return; }
      const played = session.play(move);
      if (played.ok) {
        state.lastMove = played.move;
        try { sfx(soundForMove(played.move, session.position)); } catch { sfx('move'); }
        syncBoard(true);
        if (session.status === 'success' && (session.reason === 'hold' || session.reason === 'promotion')) {
          await confirmEval();
        }
        state.busy = false;
        if (session.status !== 'in-progress') finish();
        else setStatus(`${opp} played. It is your move.`);
      } else {
        state.busy = false;
        setStatus('The engine move could not be played. You can retry this position.');
      }
    } catch (err) {
      console.warn('[endgames]', err.message);
      state.busy = false;
      if (root.isConnected && session.status === 'in-progress') setStatus('The engine did not answer in time. You can retry this position.');
    }
  }

  async function confirmEval() {
    const pending = session.status === 'success' && (session.reason === 'hold' || session.reason === 'promotion');
    try {
      const sf = startEngine();
      const lines = await sf.analyse(session.position.toFen(), { depth: 12, multipv: 1 });
      if (!root.isConnected) return;
      session.applyEval(lines);
    } catch (err) {
      console.warn('[endgames]', err && err.message ? err.message : err);
      // Fail closed: do not keep an unconfirmed hold or promotion success.
      if (pending) session.revertUnconfirmedEval();
    }
  }

  async function afterPlayer(played) {
    state.lastMove = played.move;
    state.hintStage = 0;
    board.setHint([]);
    board.setArrows([]);
    try { sfx(soundForMove(played.move, session.position)); } catch { sfx('move'); }
    syncBoard(true);
    const needsCheck = entry.goal === 'draw' || session.reason === 'promotion' || session.reason === 'hold';
    if (session.status === 'in-progress' && needsCheck || session.status === 'success' && (session.reason === 'hold' || session.reason === 'promotion')) {
      state.busy = true;
      board.setMovable(null);
      setStatus('The engine is checking the position.');
      await confirmEval();
      state.busy = false;
      if (!root.isConnected) return;
    }
    if (session.status !== 'in-progress') finish();
    else {
      setStatus('The engine is choosing a move.');
      engineMove();
    }
  }

  board.onMove = (move) => {
    if (state.busy || !session.playerToMove) return;
    const played = session.play(move);
    if (!played.ok) return;
    afterPlayer(played);
  };

  function showHint() {
    session.usedHint = true;
    const m = session.hintMove();
    if (!m) { setStatus('No prepared hint is available for this position.'); return; }
    state.hintStage += 1;
    if (state.hintStage === 1) {
      board.setHint([m.from]);
      board.setArrows([]);
      setStatus('A piece that can play the idea is highlighted.');
    } else {
      board.setHint([m.from, m.to]);
      board.setArrows([{ from: m.from, to: m.to, kind: 'hint', piece: m.piece }]);
      setStatus('The arrow shows a move that follows the idea of this position.');
    }
  }

  function showIdea() {
    session.usedHint = true;
    state.ideaShown = true;
    root.querySelector('.eg-idea')?.classList.remove('hidden');
    try {
      const line = ideaLine(entry);
      if (line[0] && session.game.moves.length === 0) {
        board.setHint([line[0].from, line[0].to]);
        board.setArrows([{ from: line[0].from, to: line[0].to, kind: 'hint', piece: line[0].piece }]);
      }
    } catch { /* idea line already validated in tests */ }
    setStatus('The idea of this position is shown below the board.');
  }

  function retry() {
    session.reset();
    state.busy = false;
    state.hintStage = 0;
    state.ideaShown = false;
    state.lastMove = null;
    board.setHint([]);
    board.setArrows([]);
    root.querySelector('.eg-idea')?.classList.add('hidden');
    const box = root.querySelector('.eg-result');
    if (box) { box.textContent = ''; box.classList.add('hidden'); box.classList.remove('ok', 'fail'); }
    root.querySelector('.eg-after')?.classList.add('hidden');
    setStatus(`${side} is to move. ${entry.goalText}`);
    syncBoard(false);
    if (session.engineToMove()) engineMove();
    else setStatus(`It is your move, as ${side}. ${entry.goalText}`);
  }

  root.querySelector('.side-col').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'hint' && session.status === 'in-progress' && session.playerToMove) showHint();
    else if (act === 'idea') showIdea();
    else if (act === 'retry') retry();
    else if (act === 'flip') board.flip();
  });

  viewer = { session, board, retry };
  window.__chess.endgame = { entry, session };
  syncBoard(false);
  if (session.engineToMove()) engineMove();
  else setStatus(`It is your move, as ${side}. ${entry.goalText}`);

  return () => {
    cleanup.forEach((f) => f()); cleanup = [];
    viewer = null;
    if (window.__chess) window.__chess.endgame = null;
    if (engine) { try { engine.terminate(); } catch { /* already gone */ } engine = null; }
  };
}

export function onKey(e) {
  if (!viewer) return false;
  if (e.key === 'r' || e.key === 'R') { viewer.retry(); return true; }
  return false;
}
