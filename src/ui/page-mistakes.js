// Personal puzzles from reviewed mistakes (#/puzzles/mistakes).
import { mods } from './modules.js';
import { settings, onSettings } from './state.js';
import { Board } from './board.js';
import { esc, toast } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { play as sfx, soundForMove } from './sound.js';
import { confirmDialog } from './dialogs.js';
import { modeTabs } from './page-puzzle-gen.js';
import { reviewStore } from '../review-storage.js';
import { JUDGMENT_LABELS, inspectMistakePuzzle, verifyMistakePuzzle } from '../review.js';
import { StockfishEngine } from './stockfish-client.js';
import { analyseWeaknesses, weaknessParagraphs } from '../mistake-insights.js';
import { badgeSvg } from './review-badges.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const EMPTY = 'Review a game to collect positions you can retry.';

function mistakeCardTitle(p) {
  const side = p.color === 'b' ? 'Black' : 'White';
  const label = (JUDGMENT_LABELS[p.judgment] || 'Mistake').toLowerCase();
  const move = Number(p.ply) > 0 ? Math.ceil(Number(p.ply) / 2) : 0;
  return move ? `${side}'s ${label}, move ${move}` : `${side}'s ${label}`;
}

function asPuzzle(p) {
  const side = p.color === 'b' ? 'Black' : 'White';
  const label = JUDGMENT_LABELS[p.judgment] || 'Mistake';
  return {
    ...p,
    title: p.gameName ? `${label} from ${p.gameName}` : `${label} by ${side}`,
    hint: 'The piece that should move is highlighted first. Select Hint again to see the destination.',
    explanation: p.bestSan
      ? `The move played in the game was ${p.playedSan || 'a weaker continuation'}. The engine's preferred move is ${p.bestSan}.`
      : 'This position is taken from a reviewed game in which a weaker move was played.',
  };
}

export async function render(root, { rest } = {}) {
  if (rest && rest[0]) return renderSolve(root, decodeURIComponent(rest[0]));
  return renderList(root);
}

function weaknessesSection(store, mistakes) {
  const reviews = typeof store.listReviews === 'function' ? store.listReviews() : [];
  if (!reviews.length && !(mistakes && mistakes.length)) return '';
  const analysis = analyseWeaknesses({ reviews, mistakes: mistakes || store.listMistakes() });
  const paras = weaknessParagraphs(analysis, { mistakes: mistakes || [] });
  if (!paras.length) return '';
  const lead = paras.filter((p) => p.id === 'sample' || p.id === 'insufficient');
  const rest = paras.filter((p) => p.id !== 'sample' && p.id !== 'insufficient');
  const more = rest.length ? `<details class="weaknesses-more">
    <summary>Read more</summary>
    ${rest.map((p) => `<p data-weakness="${esc(p.id)}">${p.html}</p>`).join('')}
  </details>` : '';
  return `<section class="weaknesses" data-weaknesses aria-labelledby="weaknesses-title">
    <h2 id="weaknesses-title">Your weaknesses</h2>
    ${lead.map((p) => `<p data-weakness="${esc(p.id)}">${p.html}</p>`).join('')}
    ${more}
  </section>`;
}

function renderList(root) {

  const store = reviewStore();
  const draw = () => {
    const all = store.listMistakes();
    const unsolved = all.filter((p) => p.solved !== true).length;
    const solved = all.filter((p) => p.solved === true).length;
    window.__chess.mistakes = all;
    const weaknesses = weaknessesSection(store, all);
    root.innerHTML = `
      <h1 class="page-title" id="title-puzzles">My mistakes</h1>
      ${modeTabs('mistakes')}
      ${weaknesses}
      ${!all.length ? `<div class="frame empty-mistakes">${fc}<div class="frame-inner">
        <h2>No positions yet</h2>
        <p>${EMPTY}</p>
        <div class="btn-row"><a class="btn primary" href="#/saved">Saved games</a></div>
      </div></div>` : `<p class="muted count">${all.length} ${all.length === 1 ? 'position' : 'positions'} · ${unsolved} unsolved · ${solved} solved</p>
        <ul class="puzzle-grid mistake-grid" aria-label="Puzzles from your mistakes">
          ${all.map((p) => {
            const legal = inspectMistakePuzzle(p).ok;
            const status = !legal ? 'Invalid' : (p.solved === true ? 'Solved' : 'Unsolved');
            const statusKind = !legal ? 'invalid' : (p.solved === true ? 'solved' : 'unsolved');
            const href = `#/puzzles/mistakes/${encodeURIComponent(p.id)}`;
            const badge = JUDGMENT_LABELS[p.judgment] ? badgeSvg(p.judgment, { className: 'review-badge-svg list' }) : '';
            const title = mistakeCardTitle(p);
            return `<li class="frame tight ${p.solved === true ? 'is-solved' : ''}${legal ? '' : ' is-invalid'}" data-id="${esc(p.id)}">${fc}<div class="frame-inner">
              <h2 class="pz-title">${badge}${legal ? `<a href="${href}">${esc(title)}</a>` : esc(title)}</h2>
              <div class="mistake-status" data-status>
                <span class="mistake-chip ${statusKind}">${esc(status)}</span>
              </div>
              <div class="btn-row">
                ${legal ? `<a class="btn small primary" href="${href}">${p.solved === true ? 'Retry' : 'Solve'}</a>` : ''}
                <button class="btn small danger" type="button" data-act="remove" data-id="${esc(p.id)}" aria-label="Remove this position">Remove</button>
              </div>
            </div></li>`;
          }).join('')}
        </ul>`}`;
    const more = root.querySelector('.weaknesses-more');
    if (more) more.open = window.matchMedia('(min-width: 641px)').matches;
  };

  root.onclick = async (e) => {
    const b = e.target.closest('[data-act="remove"]');
    if (!b) return;
    const id = b.dataset.id;
    const p = store.getMistake(id);
    if (!p) return;
    const ok = await confirmDialog('Remove this position', 'Remove this position from My mistakes?', { ok: 'Remove', danger: true });
    if (!ok) return;
    store.removeMistake(id);
    toast('Removed.');
    draw();
  };
  draw();

  let engine = null;
  const legal = store.listMistakes().filter((p) => inspectMistakePuzzle(p).ok);
  if (legal.length) {
    engine = new StockfishEngine();
    (async () => {
      try {
        for (const p of legal) {
          if (!root.isConnected) return;
          const res = await verifyMistakePuzzle(p, engine);
          const status = root.querySelector(`[data-id="${CSS.escape(p.id)}"] .mistake-status`);
          if (!status) continue;
          if (!res.ok && !status.querySelector('.unconfirmed')) {
            const tag = document.createElement('span');
            tag.className = 'mistake-chip unconfirmed';
            tag.textContent = 'Unconfirmed';
            tag.title = 'The engine has not confirmed that this is a unique solution.';
            status.appendChild(tag);
          }
        }
      } catch (err) { console.warn('[mistakes]', err && err.message ? err.message : err); }
      finally { if (engine) { try { engine.terminate(); } catch { /* already gone */ } engine = null; } }
    })();
  }
  return () => { if (engine) { try { engine.terminate(); } catch { /* already gone */ } engine = null; } };
}

function renderSolve(root, id) {
  const store = reviewStore();
  const raw = store.getMistake(id);
  if (!raw) {
    root.innerHTML = `
      <h1 class="page-title" id="title-puzzles">My mistakes</h1>
      ${modeTabs('mistakes')}
      <p class="lede">This position is not on the list.</p>
      <p><a href="#/puzzles/mistakes">Back</a></p>`;
    return;
  }
  const inspected = inspectMistakePuzzle(raw);
  if (!inspected.ok) {
    const reason = inspected.reason === 'invalid-fen'
      ? 'The stored position is not a legal FEN and cannot be shown as a puzzle.'
      : 'The stored solution is not legal in this position, so the puzzle cannot be solved.';
    root.innerHTML = `
      <h1 class="page-title" id="title-puzzles">My mistakes</h1>
      ${modeTabs('mistakes')}
      <p class="lede">${reason}</p>
      <div class="btn-row">
        <button class="btn danger" type="button" data-act="remove">Remove this position</button>
        <a class="btn" href="#/puzzles/mistakes">Back</a>
      </div>`;
    root.querySelector('[data-act="remove"]').addEventListener('click', async () => {
      const ok = await confirmDialog('Remove this position', 'Remove this position from My mistakes?', { ok: 'Remove', danger: true });
      if (!ok) return;
      store.removeMistake(id);
      toast('Removed.');
      location.hash = '#/puzzles/mistakes';
    });
    return;
  }
  const puzzle = asPuzzle(raw);
  const session = new mods.puzzles.PuzzleSession(puzzle);
  const s = settings();
  const state = { usedHint: false, failed: false, complete: false, busy: false, attempts: puzzle.attempts || 0 };
  const side = session.playerColor === 'w' ? 'White' : 'Black';
  const cleanups = [];
  window.__chess.mistake = { puzzle, session };
  root.innerHTML = `
    <h1 class="page-title" id="title-puzzles">${esc(puzzle.title)}</h1>
    <p class="lede">${side} is to move.</p>
    ${modeTabs('mistakes')}
    <div class="game-layout mode-puzzle mode-mistakes">
      <div class="board-col"><div class="board-row-wrap"><div class="board-host"></div></div></div>
      <aside class="side-col"><div class="frame panel">${fc}<div class="frame-inner">
        <p class="status puzzle-status" role="status" aria-live="polite"></p>
        <div class="controls" role="toolbar" aria-label="Puzzle controls">
          <button class="btn" type="button" data-act="hint">${ICONS.hint}<span>Hint</span></button>
          <button class="btn" type="button" data-act="retry">${ICONS.retry}<span>Retry</span></button>
          <button class="btn" type="button" data-act="flip">${ICONS.flip}<span>Flip</span></button>
          <button class="btn primary" type="button" data-act="nextpz">${ICONS.next}<span>Next</span></button>
          <button class="btn danger" type="button" data-act="remove">${ICONS.trash}<span>Remove</span></button>
        </div>
        ${DIVIDER}
        <div class="explanation hidden"><h3 class="small">Explanation</h3><p class="explanation-text"></p></div>
        <p><a href="#/puzzles/mistakes">Back</a></p>
      </div></div></aside>
    </div>`;
  const statusEl = root.querySelector('.puzzle-status');
  const setStatus = (t) => { statusEl.textContent = t; };
  const board = new Board(root.querySelector('.board-host'), {
    pieceSet: s.pieceSet, orientation: session.playerColor, showLegal: s.showLegal, showCoords: s.showCoords, animations: s.animations, autoQueen: s.autoQueen,
    label: `Position from a reviewed game. ${side} is to move.`, onMove: (m) => onMove(m),
  });
  cleanups.push(onSettings((st) => board.setOptions({ pieceSet: st.pieceSet, showLegal: st.showLegal, showCoords: st.showCoords, animations: st.animations, autoQueen: st.autoQueen })));
  const sound = (k) => { if (settings().sound) sfx(k); };

  const record = (solved) => {
    state.attempts += 1;
    try { store.markMistake(puzzle.id, { solved, attempts: state.attempts, usedHint: state.usedHint }); } catch (err) { console.warn('[mistakes]', err.message); }
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
      setStatus(`The move ${before.toSan(move)} is not the solution. Select Retry to try again, or select Hint for help.`);
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
    setStatus(state.failed ? 'You found the solution on a later attempt. The position counts as attempted.' : `The position is solved${state.usedHint ? ' with the help of a hint' : ''}.`);
    const ex = root.querySelector('.explanation');
    ex.querySelector('.explanation-text').textContent = puzzle.explanation;
    ex.classList.remove('hidden');
  }

  root.querySelector('.controls').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'retry') reset();
    else if (act === 'flip') board.flip();
    else if (act === 'hint') {
      if (state.complete) return;
      if (state.wrongShown) reset();
      const h = session.hint();
      state.usedHint = true;
      board.setHint([h.from]);
      if (h.to != null) {
        board.setArrows([{ from: h.from, to: h.to, kind: 'hint', piece: h.piece || h.type }]);
        setStatus(`The hint shows the full move.`);
      } else setStatus('The piece to move is highlighted. Select Hint again to see the destination.');
    } else if (act === 'nextpz') {
      const next = store.listMistakes().find((p) => !p.solved && p.id !== id) || store.listMistakes().find((p) => p.id !== id);
      if (next) location.hash = `#/puzzles/mistakes/${encodeURIComponent(next.id)}`;
      else toast('There are no further positions in the list.');
    } else if (act === 'remove') {
      const ok = await confirmDialog('Remove this position', 'Remove this position from My mistakes?', { ok: 'Remove', danger: true });
      if (!ok) return;
      store.removeMistake(id);
      toast('Removed.');
      location.hash = '#/puzzles/mistakes';
    }
  });
  reset();
  let engine = new StockfishEngine();
  (async () => {
    try {
      const res = await verifyMistakePuzzle(raw, engine);
      if (!root.isConnected) return;
      if (!res.ok) {
        const note = document.createElement('p');
        note.className = 'muted verify-note';
        note.textContent = 'The engine has not confirmed that this is a unique solution at depth 16. The stored move can still be tried, but another first move may also be good.';
        const panel = root.querySelector('.explanation');
        if (panel && panel.parentNode) panel.parentNode.insertBefore(note, panel);
      }
    } catch (err) { console.warn('[mistakes]', err && err.message ? err.message : err); }
    finally { if (engine) { try { engine.terminate(); } catch { /* already gone */ } engine = null; } }
  })();
  return () => { if (engine) { try { engine.terminate(); } catch { /* already gone */ } engine = null; } cleanups.forEach((f) => f()); window.__chess.mistake = null; };
}
