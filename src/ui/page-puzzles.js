// Puzzles page: list with filters (#/puzzles) and the solve view (#/puzzles/<id>).
import { mods } from './modules.js';
import { settings, onSettings } from './state.js';
import { Board } from './board.js';
import { esc, sqName, toast } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { play as sfx, soundForMove } from './sound.js';
import { modeTabs } from './page-puzzle-gen.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const THEME_LABELS = {
  'mate-in-1': 'Mate in one', 'mate-in-2': 'Mate in two', 'mate-in-3': 'Mate in three', 'mate-in-4': 'Mate in four', fork: 'Fork', pin: 'Pin', skewer: 'Skewer',
  'back-rank': 'Back-rank mate', discovered: 'Discovered attack', sacrifice: 'Sacrifice', endgame: 'Endgame', promotion: 'Promotion',
  deflection: 'Deflection', 'zugzwang-ish': 'Zugzwang',
};
const themeLabel = (t) => THEME_LABELS[t] || t;
const DIFF_LABELS = {
  1: 'Level 1 — Beginner',
  2: 'Level 2 — Intermediate',
  3: 'Level 3 — Club',
  4: 'Level 4 — Advanced',
  5: 'Level 5 — Expert',
};
const diffLabel = (d) => DIFF_LABELS[d] || `Level ${d}`;
const filterState = { theme: '', difficulty: '', status: 'all' };

const puzzlesList = () => mods.puzzleData.PUZZLES || [];
const progress = () => mods.storage.getPuzzleProgress() || { rating: 1200, puzzles: {} };
const stars = (n) => `<span class="stars" role="img" aria-label="${diffLabel(n)}">${'★'.repeat(n)}<span class="dim">${'★'.repeat(5 - n)}</span></span>`;

function filterSpec() {
  const f = {};
  if (filterState.theme) f.theme = filterState.theme;
  if (filterState.difficulty) f.difficulty = +filterState.difficulty;
  return f;
}

let cleanupFns = [];
let session = null;

export async function render(root, { rest, query }) {
  cleanupFns.forEach((f) => f()); cleanupFns = [];
  if (rest && rest[0] === 'generated') return (await import('./page-puzzle-gen.js')).render(root, { query });
  if (rest && rest[0] === 'mistakes') return (await import('./page-mistakes.js')).render(root, { rest: rest.slice(1), query });
  if (rest && rest[0]) return renderSolve(root, decodeURIComponent(rest[0]));
  return renderList(root);
}

function renderList(root) {
  const all = puzzlesList();
  const prog = progress();
  const done = prog.puzzles || {};
  const themes = Array.from(new Set(all.map((p) => p.theme)));
  root.innerHTML = `
    <h1 class="page-title" id="title-puzzles">Puzzles</h1>
    <p class="lede">Each puzzle shows a position in which one side has a strong continuation. Find the best move for the side to move. Your puzzle rating is <strong>${Math.round(prog.rating ?? mods.storage.getRating())}</strong>, and you have solved ${Object.values(done).filter((p) => p.solved).length} of ${all.length} puzzles.</p>
    ${modeTabs('list')}
    <div class="frame filters">${fc}<div class="frame-inner">
      <form class="filter-row" aria-label="Puzzle filters">
        <div><label for="pf-theme">Theme</label><select id="pf-theme" class="field" name="theme"><option value="">All themes</option>${themes.map((t) => `<option value="${esc(t)}" ${filterState.theme === t ? 'selected' : ''}>${esc(themeLabel(t))}</option>`).join('')}</select></div>
        <div><label for="pf-diff">Difficulty</label><select id="pf-diff" class="field" name="difficulty"><option value="">All levels</option>${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${String(filterState.difficulty) === String(d) ? 'selected' : ''}>${diffLabel(d)}</option>`).join('')}</select></div>
        <div><label for="pf-status">Status</label><select id="pf-status" class="field" name="status">
          <option value="all" ${filterState.status === 'all' ? 'selected' : ''}>All puzzles</option><option value="unsolved" ${filterState.status === 'unsolved' ? 'selected' : ''}>Unsolved puzzles</option><option value="solved" ${filterState.status === 'solved' ? 'selected' : ''}>Solved puzzles</option></select></div>
        <div class="filter-action"><button class="btn primary" type="button" data-act="next">${ICONS.play}<span>Start the recommended puzzle</span></button></div>
      </form>
    </div></div>
    <p class="muted count" aria-live="polite"></p>
    <ul class="puzzle-grid" aria-label="Puzzle list"></ul>`;
  const grid = root.querySelector('.puzzle-grid');
  const count = root.querySelector('.count');
  const draw = () => {
    const list = all.filter((p) => (!filterState.theme || p.theme === filterState.theme)
      && (!filterState.difficulty || p.difficulty === +filterState.difficulty)
      && (filterState.status === 'all' || (filterState.status === 'solved') === !!(done[p.id] && done[p.id].solved)));
    count.textContent = `${list.length} ${list.length === 1 ? 'puzzle matches' : 'puzzles match'} the filters.`;
    grid.innerHTML = list.map((p) => {
      const st = done[p.id];
      const status = st && st.solved ? 'Solved' : st && st.attempts ? 'Attempted' : 'Not attempted';
      return `<li><a class="puzzle-card ${st && st.solved ? 'solved' : ''}" href="#/puzzles/${encodeURIComponent(p.id)}">
        <span class="pc-title">${esc(p.title)}</span>
        <span class="pc-meta"><span class="pc-theme">${esc(themeLabel(p.theme))}</span>${stars(p.difficulty)}</span>
        <span class="pc-meta"><span>Rating ${p.rating}</span><span class="pc-status">${status}</span></span></a></li>`;
    }).join('') || '<li class="muted">No puzzles match the filters.</li>';
  };
  draw();
  const form = root.querySelector('form');
  form.addEventListener('change', () => { const fd = new FormData(form); filterState.theme = fd.get('theme'); filterState.difficulty = fd.get('difficulty'); filterState.status = fd.get('status'); draw(); });
  root.querySelector('[data-act="next"]').addEventListener('click', () => {
    const p = mods.puzzles.nextPuzzle(progress(), filterSpec());
    if (p) location.hash = `#/puzzles/${encodeURIComponent(p.id)}`; else toast('No puzzle matches the filters.');
  });
}

function renderSolve(root, id) {
  const all = puzzlesList();
  const puzzle = all.find((p) => p.id === id);
  if (!puzzle) {
    root.innerHTML = `<h1 class="page-title" id="title-puzzles">The puzzle was not found</h1><p class="lede">No puzzle has the identifier "${esc(id)}". <a href="#/puzzles">Return to the puzzle list.</a></p>`;
    return;
  }
  session = new mods.puzzles.PuzzleSession(puzzle);
  window.__chess.puzzle = { puzzle, session };
  const s = settings();
  const state = { usedHint: false, failed: false, complete: false, busy: false, attempts: (progress().puzzles?.[id]?.attempts) || 0 };
  const side = session.playerColor === 'w' ? 'White' : 'Black';
  root.innerHTML = `
    <h1 class="page-title" id="title-puzzles">${esc(puzzle.title)}</h1>
    <p class="lede">${side} is to move. ${esc(themeLabel(puzzle.theme))}, ${esc(diffLabel(puzzle.difficulty))}, rated ${puzzle.rating}.</p>
    <div class="game-layout mode-puzzle">
      <div class="board-col"><div class="board-row-wrap"><div class="board-host"></div></div></div>
      <aside class="side-col"><div class="frame panel">${fc}<div class="frame-inner">
        <p class="status puzzle-status" role="status" aria-live="polite"></p>
        <div class="controls" role="toolbar" aria-label="Puzzle controls">
          <button class="btn" type="button" data-act="hint">${ICONS.hint}<span>Hint</span></button>
          <button class="btn" type="button" data-act="retry">${ICONS.retry}<span>Retry</span></button>
          <button class="btn" type="button" data-act="flip">${ICONS.flip}<span>Flip board</span></button>
          <button class="btn primary" type="button" data-act="nextpz">${ICONS.next}<span>Next puzzle</span></button>
        </div>
        ${DIVIDER}
        <div class="explanation hidden"><h3 class="small">Explanation</h3><p class="explanation-text"></p></div>
        <dl class="stat-grid compact">
          <div><dt>Your rating</dt><dd class="pz-rating">${Math.round(mods.storage.getRating())}</dd></div>
          <div><dt>Puzzle rating</dt><dd>${puzzle.rating}</dd></div>
          <div><dt>Theme</dt><dd>${esc(themeLabel(puzzle.theme))}</dd></div>
          <div><dt>Difficulty</dt><dd>${stars(puzzle.difficulty)}</dd></div>
        </dl>
        <p><a href="#/puzzles">Return to the puzzle list.</a></p>
      </div></div></aside>
    </div>`;
  const statusEl = root.querySelector('.puzzle-status');
  const setStatus = (t) => { statusEl.textContent = t; };
  const board = new Board(root.querySelector('.board-host'), {
    pieceSet: s.pieceSet, orientation: session.playerColor, showLegal: s.showLegal, showCoords: s.showCoords, animations: s.animations, autoQueen: s.autoQueen,
    label: `Puzzle board. ${side} is to move.`, onMove: (m) => onMove(m),
  });
  cleanupFns.push(onSettings((st) => board.setOptions({ pieceSet: st.pieceSet, showLegal: st.showLegal, showCoords: st.showCoords, animations: st.animations, autoQueen: st.autoQueen })));
  const sound = (k) => { if (settings().sound) sfx(k); };

  const record = (solved) => {
    state.attempts += 1;
    try {
      mods.storage.markPuzzle(puzzle.id, { solved, attempts: state.attempts, usedHint: state.usedHint, puzzleRating: puzzle.rating });
    } catch (err) { console.warn('[puzzle]', err.message); }
    root.querySelector('.pz-rating').textContent = Math.round(mods.storage.getRating());
  };

  const reset = () => {
    session.reset();
    state.complete = false; state.busy = false; state.wrongShown = false;
    board.setArrows([]);
    board.setPosition(session.position);
    board.setMovable(session.playerColor);
    root.querySelector('.explanation').classList.add('hidden');
    setStatus(`Find the best move for ${side}.`);
  };

  async function onMove(move) {
    if (state.busy || state.complete) return;
    const before = session.position;
    const res = session.tryMove(move);
    const after = before.makeMove(move);
    board.setArrows([]);
    if (res.status === 'wrong') {
      board.setPosition(after, { lastMove: move, animate: true });
      board.setMovable(null);
      sound('wrong');
      setStatus(`The move ${before.toSan(move)} is not the solution. Select Retry to try the puzzle again, or select Hint for help.`);
      if (!state.failed) { state.failed = true; record(false); }
      state.wrongShown = true;
      return;
    }
    board.setPosition(after, { lastMove: move, animate: true });
    sound(soundForMove(move, after));
    if (res.status === 'complete' && !res.reply) return finish();
    state.busy = true; board.setMovable(null);
    setStatus(`The move ${before.toSan(move)} is correct. The opponent is replying.`);
    await new Promise((r) => setTimeout(r, 550));
    if (!root.isConnected) return;
    if (res.reply) {
      board.setPosition(session.position, { lastMove: res.reply, animate: true });
      sound(soundForMove(res.reply, session.position));
    }
    state.busy = false;
    if (res.status === 'complete') return finish();
    board.setMovable(session.playerColor);
    setStatus(`The opponent played ${after.toSan(res.reply)}. Find the next move for ${side}.`);
  }

  function finish() {
    state.complete = true;
    board.setMovable(null);
    sound('correct');
    if (!state.failed) record(true);
    setStatus(state.failed ? 'You found the solution on a later attempt. The puzzle counts as attempted.' : `The puzzle is solved${state.usedHint ? ' with the help of a hint' : ''}.`);
    const ex = root.querySelector('.explanation');
    ex.querySelector('.explanation-text').textContent = puzzle.explanation || 'The solution is complete.';
    ex.classList.remove('hidden');
    root.querySelector('[data-act="nextpz"]').focus();
  }

  root.querySelector('.controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'retry') reset();
    else if (act === 'flip') board.flip();
    else if (act === 'nextpz') {
      const p = mods.puzzles.nextPuzzle(progress(), filterSpec());
      const target = p && p.id === puzzle.id ? all[(all.indexOf(puzzle) + 1) % all.length] : p;
      if (target) location.hash = `#/puzzles/${encodeURIComponent(target.id)}`;
    } else if (act === 'hint') {
      if (state.complete) return;
      if (state.wrongShown) reset();
      const h = session.hint();
      state.usedHint = true;
      board.setHint([h.from]);
      if (h.to != null) { board.setArrows([{ from: h.from, to: h.to, kind: 'hint', piece: h.piece || h.type }]); setStatus(`The hint shows the full move, from ${sqName(h.from)} to ${sqName(h.to)}.`); }
      else setStatus(`${puzzle.hint ? puzzle.hint + ' ' : ''}The piece to move is on ${sqName(h.from)}. Select Hint again to see the destination.`);
    }
  });
  reset();
  return () => { cleanupFns.forEach((f) => f()); cleanupFns = []; window.__chess.puzzle = null; };
}

export function onKey(e) {
  if ((e.key === 'n' || e.key === 'N') && document.querySelector('.mode-gen')) { const b = document.querySelector('.mode-gen [data-act="next"]'); if (b && !b.disabled) { b.click(); return true; } return false; }
  if (e.key === 'n' || e.key === 'N') { const b = document.querySelector('[data-act="nextpz"]'); if (b) { b.click(); return true; } }
  return false;
}
