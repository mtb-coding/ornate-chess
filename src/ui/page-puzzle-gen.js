// Generated puzzles (#/puzzles/generated). Puzzles are created on this device
// by src/puzzle-gen.js in background workers; see puzzle-gen-client.js.
import { mods } from './modules.js';
import { settings, onSettings } from './state.js';
import { Board } from './board.js';
import { esc, sqName, toast, copyText } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { play as sfx, soundForMove } from './sound.js';
import { generator, readStats, recordResult } from './puzzle-gen-client.js';
import { GeneratedSession } from '../puzzle-gen.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const LEVEL_TEXT = {
  easy: 'Easy puzzles are solved in one or two moves, such as a mate in one or the capture of an undefended piece.',
  medium: 'Medium puzzles usually need two moves, such as a fork followed by a capture or a mate in two.',
  hard: 'Hard puzzles need three or more moves, a quiet first move, a sacrifice or a mate in three.',
};
const LEVEL_KEY = 'ornate-chess:gen-level';
const STEP_PAUSE = 520;

export const modeTabs = (active) => `<nav class="mode-tabs" aria-label="Puzzle modes">
  <a href="#/puzzles" ${active === 'list' ? 'aria-current="page"' : ''}>Puzzle collection</a>
  <a href="#/puzzles/generated" ${active === 'gen' ? 'aria-current="page"' : ''}>Generated puzzles</a>
  <a href="#/puzzles/mistakes" ${active === 'mistakes' ? 'aria-current="page"' : ''}>My mistakes</a></nav>`;

export function render(root, { query } = {}) {
  const gen = generator();
  window.__chess.generator = gen;
  const s = settings();
  let stored = null;
  try { stored = localStorage.getItem(LEVEL_KEY); } catch { /* storage may be blocked */ }
  let level = (query && query.get('level')) || stored || 'medium';
  if (!LEVEL_NAMES[level]) level = 'medium';
  const cleanups = [];
  let session = null;
  let puzzle = null;
  let token = 0;
  const st = { busy: false, wrongMoves: 0, usedHint: false, revealed: false, recorded: false };

  root.innerHTML = `
    <h1 class="page-title" id="title-puzzles">Generated puzzles</h1>
    <p class="lede">The puzzles in this mode are created on this device from computer-played games. Each solution is checked on this device with a bundled copy of the Stockfish engine. For puzzles that win material, this check estimates that the solution is at least two pawns better than every other first move, and at least four pawns better than any other move that also wins. A deeper analysis, or a different engine network, may sometimes rate a second move more closely. For mating puzzles, the check requires that no other first move forces mate faster.</p>
    ${modeTabs('gen')}
    <div class="game-layout mode-puzzle mode-gen">
      <div class="board-col"><div class="board-row-wrap"><div class="board-host"></div></div></div>
      <aside class="side-col"><div class="frame panel">${fc}<div class="frame-inner">
        <div class="gen-level-row">
          <label for="gen-level">Difficulty</label>
          <select id="gen-level" class="field" aria-describedby="gen-level-text">${Object.entries(LEVEL_NAMES).map(([id, n]) => `<option value="${id}" ${id === level ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        <p class="help" id="gen-level-text"></p>
        <p class="status puzzle-status" role="status" aria-live="polite"></p>
        <p class="help gen-elapsed hidden" role="status" aria-live="polite"></p>
        <p class="help gen-unverified hidden">This puzzle was rebuilt from a code, and the engine has not confirmed a unique solution. It is shown without that claim, so that you can still try the position.</p>
        <div class="controls" role="toolbar" aria-label="Puzzle controls">
          <button class="btn" type="button" data-act="hint">${ICONS.hint}<span>Hint</span></button>
          <button class="btn" type="button" data-act="solution">${ICONS.play}<span>Show solution</span></button>
          <button class="btn" type="button" data-act="retry">${ICONS.retry}<span>Restart</span></button>
          <button class="btn" type="button" data-act="flip">${ICONS.flip}<span>Flip board</span></button>
          <button class="btn primary span2" type="button" data-act="next">${ICONS.next}<span>Next puzzle</span></button>
        </div>
        <div class="gen-result hidden" aria-live="polite">
          <p class="gen-theme"><span class="gen-theme-label"></span></p>
          <p class="gen-expl"></p>
        </div>
        ${DIVIDER}
        <dl class="stat-grid compact gen-stats">
          <div><dt>Solved</dt><dd data-stat="solved">0</dd></div>
          <div><dt>Current streak</dt><dd data-stat="streak">0</dd></div>
          <div><dt>Best streak</dt><dd data-stat="best">0</dd></div>
          <div><dt>Ready</dt><dd data-stat="ready">0</dd></div>
        </dl>
        <p class="help gen-rule">A puzzle counts towards the streak when it is solved without a wrong move, a hint or the solution. Moving on from a puzzle after a wrong move or a hint ends the streak.</p>
        <p class="help gen-credit">The engine is Stockfish 19 in the Stockfish.js build, which is free software under the <a href="src/vendor/stockfish/COPYING.txt" target="_blank" rel="noopener">GNU General Public License, version 3</a>. The source of the engine is available from <a href="https://github.com/official-stockfish/Stockfish" target="_blank" rel="noopener">github.com/official-stockfish/Stockfish</a>, and the source of this build is available from <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">github.com/nmrugg/stockfish.js</a>.</p>
        <details class="gen-code">
          <summary>Puzzle code</summary>
          <p class="help">Every generated puzzle has a code that rebuilds exactly the same position on any device.</p>
          <p class="gen-code-now">No puzzle is loaded yet.</p>
          <form class="gen-code-form">
            <label for="gen-code-input">Load a puzzle from its code</label>
            <div class="gen-code-row"><input id="gen-code-input" class="field" name="code" autocomplete="off" spellcheck="false" placeholder="For example m1a2b3c.k"><button class="btn" type="submit">Load</button></div>
          </form>
        </details>
      </div></div></aside>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const statusEl = $('.puzzle-status');
  const setStatus = (t) => { statusEl.textContent = t; };
  let elapsedTimer = 0;
  function stopElapsed() {
    clearInterval(elapsedTimer);
    elapsedTimer = 0;
    const el = $('.gen-elapsed');
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  }
  function startElapsed() {
    stopElapsed();
    const el = $('.gen-elapsed');
    if (!el) return;
    const t0 = Date.now();
    const tick = () => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      el.classList.remove('hidden');
      el.textContent = sec === 0
        ? 'The wait has just started.'
        : `The wait so far is ${sec} ${sec === 1 ? 'second' : 'seconds'}.`;
    };
    tick();
    elapsedTimer = setInterval(tick, 1000);
  }
  const board = new Board($('.board-host'), {
    pieceSet: s.pieceSet, orientation: 'w', showLegal: s.showLegal, showCoords: s.showCoords, animations: s.animations, autoQueen: s.autoQueen,
    label: 'Puzzle board', onMove: (m) => onMove(m),
  });
  cleanups.push(onSettings((x) => board.setOptions({ pieceSet: x.pieceSet, showLegal: x.showLegal, showCoords: x.showCoords, animations: x.animations, autoQueen: x.autoQueen })));
  board.setPosition(mods.engine.Position.fromFen(mods.engine.START_FEN));
  const sound = (k) => { if (settings().sound) sfx(k); };
  const sideName = () => (session && session.playerColor === 'b' ? 'Black' : 'White');

  function drawStats() {
    const x = readStats();
    root.querySelector('[data-stat="solved"]').textContent = x.solved;
    root.querySelector('[data-stat="streak"]').textContent = x.streak;
    root.querySelector('[data-stat="best"]').textContent = x.best;
    root.querySelector('[data-stat="ready"]').textContent = gen.status().ready;
  }
  function drawLevelText() { $('#gen-level-text').textContent = LEVEL_TEXT[level]; }
  function setButtons() {
    const active = !!session && !session.complete && !st.busy;
    root.querySelector('[data-act="hint"]').disabled = !active;
    root.querySelector('[data-act="solution"]').disabled = !active;
    root.querySelector('[data-act="retry"]').disabled = !session || st.busy;
  }

  function record(clean, solved = !st.revealed) {
    if (st.recorded || !puzzle) return;
    st.recorded = true;
    recordResult(puzzle.level, clean, solved);
    drawStats();
  }

  function showResult(solvedText) {
    const box = $('.gen-result');
    const levelName = LEVEL_NAMES[puzzle.level].toLowerCase();
    const article = levelName === 'easy' ? 'an' : 'a';
    $('.gen-theme-label').textContent = `The theme of this puzzle is ${puzzle.title.charAt(0).toLowerCase() + puzzle.title.slice(1)}, and it is ${article} ${levelName} puzzle rated about ${puzzle.rating}.`;
    $('.gen-expl').textContent = puzzle.explanation;
    box.classList.remove('hidden');
    setStatus(solvedText);
    board.setMovable(null);
    setButtons();
    root.querySelector('[data-act="next"]').focus({ preventScroll: true });
  }

  function load(p) {
    try { session = new GeneratedSession(p); } catch (err) {
      // A damaged puzzle is dropped and the next one is requested.
      console.warn('[generated puzzles] A puzzle could not be loaded.', err);
      gen.discard(p);
      puzzle = null; session = null;
      next();
      return;
    }
    stopElapsed();
    puzzle = p;
    window.__chess.genPuzzle = { puzzle: p, session };
    Object.assign(st, { busy: false, wrongMoves: 0, usedHint: false, revealed: false, recorded: false });
    $('.gen-result').classList.add('hidden');
    board.setArrows([]); board.setHint([]);
    board.setOptions({ orientation: session.playerColor, label: `Puzzle board. ${sideName()} is to move.` });
    board.setPosition(session.position);
    board.setMovable(session.playerColor);
    $('.gen-code-now').innerHTML = `The code of this puzzle is <code>${esc(p.code)}</code>. <button class="btn link-btn" type="button" data-act="copy">Copy the code</button>`;
    const unverified = p.verified === false;
    $('.gen-unverified').classList.toggle('hidden', !unverified);
    setStatus(`${sideName()} is to move. Find the best move for ${sideName()}.`);
    setButtons();
    drawStats();
  }

  async function next() {
    const my = ++token;
    // Leaving a started puzzle unsolved after a wrong move or a hint ends the streak.
    if (puzzle && !st.recorded && (st.wrongMoves || st.usedHint) && !(session && session.complete)) record(false, false);
    session = null; puzzle = null;
    board.setMovable(null); board.setArrows([]); board.setHint([]);
    $('.gen-result').classList.add('hidden');
    $('.gen-unverified').classList.add('hidden');
    setButtons();
    const ready = gen.status().ready > 0;
    if (!ready) {
      setStatus('The generator is creating a puzzle. Easy puzzles usually take a few seconds, while medium and hard puzzles can take about half a minute on a fast device and a few minutes on a slow one. Later puzzles are prepared while you solve.');
      startElapsed();
    } else stopElapsed();
    root.classList.toggle('is-generating', !ready);
    if (gen.status().broken) gen.retry();
    let p;
    try { p = await gen.take(level); } catch (err) {
      if (my !== token || !root.isConnected) return;
      stopElapsed();
      root.classList.remove('is-generating');
      setStatus('The generator could not create a puzzle. The chess engine may be unavailable on this device. Select Next puzzle to try again, or use the puzzle collection.');
      return;
    }
    if (my !== token || !root.isConnected) return;
    stopElapsed();
    root.classList.remove('is-generating');
    load(p);
  }

  async function onMove(move) {
    if (!session || st.busy || session.complete) return;
    const before = session.position;
    const res = session.tryMove(move);
    board.setArrows([]); board.setHint([]);
    if (res.status === 'wrong') {
      st.wrongMoves++;
      sound('wrong');
      const san = before.toSan(before.codeToMove(before.moveCode(move)));
      board.setPosition(before.makeMove(move), { lastMove: move, animate: true });
      st.busy = true; setButtons();
      setStatus(`The move ${san} is not the solution. The position has been restored, so you can try another move.`);
      await new Promise((r) => setTimeout(r, 850));
      if (!root.isConnected || session.position !== before) return;
      board.setPosition(before);
      st.busy = false; board.setMovable(session.playerColor); setButtons();
      return;
    }
    const after = before.makeMove(res.move);
    board.setPosition(after, { lastMove: res.move, animate: true });
    sound(soundForMove(res.move, after));
    if (res.status === 'complete') return finish();
    st.busy = true; board.setMovable(null); setButtons();
    setStatus(`The move ${before.toSan(res.move)} is correct. The opponent is replying.`);
    await new Promise((r) => setTimeout(r, STEP_PAUSE));
    if (!root.isConnected) return;
    board.setPosition(session.position, { lastMove: res.reply, animate: true });
    sound(soundForMove(res.reply, session.position));
    st.busy = false; board.setMovable(session.playerColor); setButtons();
    setStatus(`The opponent played ${after.toSan(res.reply)}. Find the next move for ${sideName()}.`);
  }

  function finish() {
    sound('correct');
    const clean = !st.wrongMoves && !st.usedHint && !st.revealed;
    record(clean);
    let text;
    if (clean) text = `The puzzle is solved. Your streak is now ${readStats().streak}.`;
    else if (st.revealed) text = 'The solution has been shown. The puzzle does not count as solved.';
    else text = `The puzzle is solved${st.usedHint ? ' with a hint' : ''}${st.wrongMoves ? ` after ${st.wrongMoves} wrong ${st.wrongMoves === 1 ? 'move' : 'moves'}` : ''}, so it does not count towards the streak.`;
    showResult(text);
  }

  async function revealSolution() {
    if (!session || session.complete || st.busy) return;
    st.revealed = true; st.busy = true; setButtons(); board.setMovable(null);
    setStatus('The solution is being played on the board.');
    const moves = session.remaining();
    for (const m of moves) {
      await new Promise((r) => setTimeout(r, STEP_PAUSE));
      if (!root.isConnected || !session) return;
      const before = session.position;
      const p = before.makeMove(m);
      session.position = p; session.ply++;
      board.setPosition(p, { lastMove: m, animate: true });
      sound(soundForMove(m, p));
    }
    session.complete = true; st.busy = false;
    record(false);
    finish();
  }

  root.querySelector('.controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'next') next();
    else if (act === 'flip') board.flip();
    else if (act === 'solution') revealSolution();
    else if (act === 'retry' && puzzle) { const p = puzzle; const keep = { ...st }; load(p); st.wrongMoves = keep.wrongMoves; st.usedHint = keep.usedHint; st.revealed = keep.revealed; st.recorded = keep.recorded; }
    else if (act === 'hint' && session && !session.complete) {
      const h = session.hint(); if (!h) return;
      st.usedHint = true;
      board.setHint([h.from]);
      if (h.to != null) { board.setArrows([{ from: h.from, to: h.to, kind: 'hint', piece: h.piece || h.type }]); setStatus(`The hint shows the full move, from ${sqName(h.from)} to ${sqName(h.to)}.`); }
      else setStatus(`The piece to move stands on ${sqName(h.from)}. Select Hint again to see the destination.`);
    }
  });
  root.querySelector('.gen-code').addEventListener('click', async (e) => {
    if (e.target.closest('[data-act="copy"]') && puzzle) toast(await copyText(puzzle.code) ? 'The puzzle code was copied.' : 'The puzzle code could not be copied.');
  });
  root.querySelector('.gen-code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code') || '').trim().toLowerCase();
    if (!/^[emh][0-9a-z]+\.[0-9a-z]+$/.test(code)) { toast('A puzzle code has a letter for the difficulty, a number and a dot, for example m1a2b3c.k.'); return; }
    const my = ++token;
    $('.gen-unverified').classList.add('hidden');
    setStatus('The puzzle is being rebuilt from its code, and the engine will then check the solution.');
    startElapsed();
    const p = await gen.fromCode(code);
    if (my !== token || !root.isConnected) return;
    stopElapsed();
    if (!p) { setStatus('No puzzle could be rebuilt from that code.'); return; }
    load(p);
  });
  $('#gen-level').addEventListener('change', (e) => {
    level = e.target.value;
    try { localStorage.setItem(LEVEL_KEY, level); } catch { /* ignore */ }
    drawLevelText();
    gen.cancelWaiting();
    next();
  });
  cleanups.push(gen.onStatus(() => drawStats()));
  drawLevelText();
  drawStats();
  const code = query && query.get('code');
  if (code) { $('#gen-code-input').value = code; root.querySelector('.gen-code-form').requestSubmit(); } else next();

  return () => {
    token++;
    stopElapsed();
    cleanups.forEach((f) => f());
    gen.stop();
    window.__chess.genPuzzle = null;
  };
}

export function onKey(e) {
  if (e.key === 'n' || e.key === 'N') { const b = document.querySelector('[data-act="next"]'); if (b) { b.click(); return true; } }
  return false;
}
