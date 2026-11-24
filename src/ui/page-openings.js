// Opening library (#/openings and #/openings/<id>): browse, search, step
// through a line on the board and practise it from either side.
import { mods } from './modules.js';
import { app, settings, onSettings, updateSettings } from './state.js';
import { Board } from './board.js';
import { esc } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { play as sfx, soundForMove } from './sound.js';
import { LIBRARY, LIBRARY_CATEGORIES } from '../data/opening-library.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const SIDE_NAME = { w: 'White', b: 'Black' };
const filter = { q: '', cat: '' };
const fold = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** "1. e4 e5 2. Nf3" from a SAN array. */
export function numbered(sans, upto = sans.length) {
  return sans.slice(0, upto).map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ');
}
const splitName = (name) => { const i = name.indexOf(':'); return i < 0 ? { family: name, variation: '' } : { family: name.slice(0, i), variation: name.slice(i + 1).trim() }; };

let cleanup = [];
let viewer = null;

export function render(root, { rest }) {
  cleanup.forEach((f) => f()); cleanup = [];
  if (rest && rest[0]) return renderDetail(root, decodeURIComponent(rest[0]));
  return renderList(root);
}

// ---- Browse -------------------------------------------------------------------
function renderList(root) {
  root.innerHTML = `
    <h1 class="page-title" id="title-openings">Opening library</h1>
    <p class="lede">The library contains ${LIBRARY.length} well-known openings and variations with their ECO codes. Select an opening to step through its moves on the board, read about its main idea and practise it from either side.</p>
    <div class="frame filters">${fc}<div class="frame-inner">
      <form class="filter-row op-filter" aria-label="Opening filters" role="search">
        <div class="op-search"><label for="op-q">Search by name, ECO code or moves</label><input id="op-q" class="field" type="search" name="q" value="${esc(filter.q)}" placeholder="For example Sicilian, C42 or Nf3" autocomplete="off"></div>
        <div><label for="op-cat">Category</label><select id="op-cat" class="field" name="cat"><option value="">All categories</option>${LIBRARY_CATEGORIES.map((c) => `<option value="${c.id}" ${filter.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </form>
    </div></div>
    <p class="muted count" aria-live="polite"></p>
    <div class="op-groups"></div>`;
  const groups = root.querySelector('.op-groups');
  const count = root.querySelector('.count');
  const draw = () => {
    const q = fold(filter.q.trim());
    const list = LIBRARY.filter((o) => (!filter.cat || o.category === filter.cat)
      && (!q || fold(o.name).includes(q) || o.eco.toLowerCase() === q || o.eco.toLowerCase().startsWith(q) || fold(o.moves).includes(q) || fold(numbered(o.moves.split(' '))).includes(q)));
    count.textContent = list.length === LIBRARY.length ? `All ${list.length} openings are shown.` : `${list.length} ${list.length === 1 ? 'opening matches' : 'openings match'} the search.`;
    groups.innerHTML = LIBRARY_CATEGORIES.map((c) => {
      const items = list.filter((o) => o.category === c.id);
      if (!items.length) return '';
      return `<section class="op-group" aria-labelledby="opg-${c.id}"><h2 id="opg-${c.id}" class="op-group-title">${esc(c.name)}</h2><p class="muted op-group-text">${esc(c.text)}</p>
        <ul class="op-grid">${items.map((o) => { const n = splitName(o.name); return `<li><a class="op-card" href="#/openings/${encodeURIComponent(o.id)}">
          <span class="op-card-head"><abbr class="ob-eco" title="Encyclopaedia of Chess Openings code">${esc(o.eco)}</abbr><span class="op-family">${esc(n.family)}</span></span>
          ${n.variation ? `<span class="op-variation">${esc(n.variation)}</span>` : ''}
          <span class="op-moves">${esc(numbered(o.moves.split(' ')))}</span></a></li>`; }).join('')}</ul></section>`;
    }).join('') || '<p class="muted center">No opening matches the search. Try a shorter name or an ECO code such as B90.</p>';
  };
  draw();
  const form = root.querySelector('form');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', () => { filter.q = form.q.value; filter.cat = form.cat.value; draw(); });
  form.addEventListener('change', () => { filter.q = form.q.value; filter.cat = form.cat.value; draw(); });
}

// ---- Viewer and practice -----------------------------------------------------
function renderDetail(root, id) {
  const entry = LIBRARY.find((o) => o.id === id);
  if (!entry) {
    root.innerHTML = `<h1 class="page-title" id="title-openings">The opening was not found</h1><p class="lede">No opening in the library has the identifier "${esc(id)}". <a href="#/openings">Return to the opening library.</a></p>`;
    return;
  }
  const { Position, START_FEN } = mods.engine;
  const sans = entry.moves.split(' ');
  const positions = [Position.fromFen(START_FEN)];
  const moves = [];
  for (const s of sans) { const p = positions[positions.length - 1]; const m = p.parseSan(s); moves.push(m); positions.push(p.makeMove(m)); }
  const n = splitName(entry.name);
  const cat = LIBRARY_CATEGORIES.find((c) => c.id === entry.category);
  const s = settings();
  // `run` is a counter that changes whenever practice starts or stops, so that a delayed step of an earlier run is ignored.
  const state = { ply: sans.length, mode: 'view', side: entry.side, wrong: 0, busy: false, run: 0 };
  if (window.__chess) window.__chess.opening = { entry, state, sans };
  const idx = LIBRARY.indexOf(entry);
  const prevE = LIBRARY[idx - 1], nextE = LIBRARY[idx + 1];

  root.innerHTML = `
    <p class="op-back"><a href="#/openings">${ICONS.prev}<span>Opening library</span></a></p>
    <h1 class="page-title op-title" id="title-openings">${esc(n.family)}${n.variation ? `<span class="op-title-var">${esc(n.variation)}</span>` : ''}</h1>
    <p class="lede"><abbr class="ob-eco" title="Encyclopaedia of Chess Openings code">${esc(entry.eco)}</abbr> This line belongs to the ${esc(cat ? cat.name.toLowerCase() : 'library')}, consists of ${sans.length} ${sans.length === 1 ? 'half-move' : 'half-moves'} and is usually chosen by ${SIDE_NAME[entry.side]}.</p>
    <div class="game-layout mode-opening">
      <div class="board-col"><div class="board-row-wrap"><div class="board-host"></div></div></div>
      <aside class="side-col"><div class="frame panel">${fc}<div class="frame-inner">
        <p class="op-desc">${esc(entry.description)}</p>
        <p class="status op-status" role="status" aria-live="polite"></p>
        <div class="op-view-tools">
          <div class="controls nav-controls" role="toolbar" aria-label="Move navigation">
            <button class="btn" type="button" data-nav="first" aria-label="Go to the start position" title="Start position">${ICONS.first}</button>
            <button class="btn" type="button" data-nav="prev" aria-label="Go back one move" title="Back one move">${ICONS.prev}</button>
            <button class="btn" type="button" data-nav="next" aria-label="Go forward one move" title="Forward one move">${ICONS.next}</button>
            <button class="btn" type="button" data-nav="last" aria-label="Go to the end of the line" title="End of the line">${ICONS.last}</button>
          </div>
          <div class="movelist op-movelist" aria-label="Moves of the line"></div>
        </div>
        ${DIVIDER}
        <section class="op-practice" aria-labelledby="op-pr-title">
          <h2 class="small" id="op-pr-title">Practice</h2>
          <p class="help op-pr-help">Play the moves of the line yourself. The board plays the other side's book moves, and a wrong move is taken back so that you can try again.</p>
          <fieldset class="op-side"><legend class="sr-only">Side to practise</legend>
            <label class="choice"><input type="radio" name="op-side" value="w" ${entry.side === 'w' ? 'checked' : ''}><span>Play as White</span></label>
            <label class="choice"><input type="radio" name="op-side" value="b" ${entry.side === 'b' ? 'checked' : ''}><span>Play as Black</span></label>
          </fieldset>
          <div class="controls op-pr-controls">
            <button class="btn primary" type="button" data-pr="start">${ICONS.play}<span>Start practice</span></button>
            <button class="btn" type="button" data-pr="show" hidden>${ICONS.hint}<span>Show the move</span></button>
            <button class="btn" type="button" data-pr="stop" hidden>${ICONS.stop}<span>Stop practice</span></button>
          </div>
          <div class="op-continue" hidden>
            <label for="op-level">Bot difficulty</label>
            <select id="op-level" class="field">${mods.ai.DIFFICULTIES.map((d) => `<option value="${esc(d.id)}" ${d.id === s.lastBotLevel ? 'selected' : ''}>${esc(d.name)}${d.elo ? ` (about ${d.elo})` : ''}</option>`).join('')}</select>
            <button class="btn primary" type="button" data-pr="bot">${ICONS.play}<span>Continue against the bot</span></button>
            <p class="help">The game continues from the final position of the line. Games started this way are not rated.</p>
          </div>
        </section>
        ${DIVIDER}
        <p class="op-neighbours">${prevE ? `<a href="#/openings/${encodeURIComponent(prevE.id)}">Previous: ${esc(prevE.name)}</a>` : ''}${nextE ? `<a href="#/openings/${encodeURIComponent(nextE.id)}">Next: ${esc(nextE.name)}</a>` : ''}</p>
      </div></div></aside>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const statusEl = $('.op-status');
  const setStatus = (t) => { statusEl.textContent = t; };
  const sound = (k) => { if (settings().sound) sfx(k); };
  const board = new Board($('.board-host'), {
    pieceSet: s.pieceSet, orientation: entry.side, showLegal: s.showLegal, showCoords: s.showCoords, animations: s.animations, autoQueen: s.autoQueen,
    label: `Board showing the ${entry.name}`, onMove: (m) => onMove(m),
  });
  cleanup.push(onSettings((x) => board.setOptions({ pieceSet: x.pieceSet, showLegal: x.showLegal, showCoords: x.showCoords, animations: x.animations, autoQueen: x.autoQueen })));

  function moveListHtml(upto) {
    let html = '<ol class="moves">';
    for (let i = 0; i < upto; i += 2) {
      const cell = (k) => `<button type="button" class="mv ${k + 1 === state.ply ? 'current' : ''}" data-ply="${k + 1}" aria-label="Move ${Math.floor(k / 2) + 1}, ${k % 2 ? 'Black' : 'White'}: ${esc(sans[k])}">${esc(sans[k])}</button>`;
      html += `<li><span class="mvn">${i / 2 + 1}.</span>${cell(i)}${i + 1 < upto ? cell(i + 1) : ''}</li>`;
    }
    return `${html}</ol>`;
  }
  function describePly() {
    if (state.ply === 0) return 'The board shows the starting position. Select Forward to play the first move of the line.';
    const k = state.ply - 1;
    const who = k % 2 ? 'Black' : 'White';
    const end = state.ply === sans.length ? ' This is the final position of the line.' : '';
    return `${who} played ${Math.floor(k / 2) + 1}.${k % 2 ? '..' : ''} ${sans[k]}.${end}`;
  }
  function drawView(animate = false) {
    board.setPosition(positions[state.ply], { lastMove: state.ply ? moves[state.ply - 1] : null, animate });
    $('.op-movelist').innerHTML = moveListHtml(state.mode === 'view' ? sans.length : state.ply);
    root.querySelectorAll('[data-nav]').forEach((b) => {
      const back = b.dataset.nav === 'first' || b.dataset.nav === 'prev';
      b.disabled = state.mode !== 'view' || (back ? state.ply === 0 : state.ply === sans.length);
    });
    if (state.mode === 'view') setStatus(describePly());
    const cur = $('.op-movelist .mv.current');
    if (cur && cur.scrollIntoView) { const list = $('.op-movelist'); const lr = list.getBoundingClientRect(), cr = cur.getBoundingClientRect(); if (cr.bottom > lr.bottom || cr.top < lr.top) list.scrollTop += cr.top - lr.top - lr.height / 2; }
  }
  function go(ply) {
    if (state.mode !== 'view') return;
    const target = Math.max(0, Math.min(sans.length, ply));
    const animate = target === state.ply + 1;
    if (animate) sound(soundForMove(moves[state.ply], positions[target]));
    state.ply = target;
    drawView(animate);
  }
  viewer = { go: (d) => go(state.ply + d), first: () => go(0), last: () => go(sans.length) };

  // ---- Practice ----
  const userTurn = () => (state.ply % 2 === 0 ? 'w' : 'b') === state.side;
  function setPracticeUi(on, finished = false) {
    $('[data-pr="start"]').hidden = on && !finished;
    $('[data-pr="show"]').hidden = !on || finished;
    $('[data-pr="stop"]').hidden = !on;
    $('.op-continue').hidden = !finished;
    $('[data-pr="start"] span').textContent = finished ? 'Practise again' : 'Start practice';
    root.querySelectorAll('input[name="op-side"]').forEach((r) => { r.disabled = on && !finished; });
    $('.op-view-tools').classList.toggle('practising', on);
  }
  async function botStep() {
    const run = state.run;
    while (state.run === run && state.mode === 'practice' && state.ply < sans.length && !userTurn()) {
      state.busy = true; board.setMovable(null);
      await new Promise((r) => setTimeout(r, 450));
      if (!root.isConnected || state.run !== run || state.mode !== 'practice') return;
      state.ply++;
      board.setPosition(positions[state.ply], { lastMove: moves[state.ply - 1], animate: true });
      sound(soundForMove(moves[state.ply - 1], positions[state.ply]));
      $('.op-movelist').innerHTML = moveListHtml(state.ply);
    }
    if (state.run !== run) return;
    state.busy = false;
    if (state.mode !== 'practice') return;
    if (state.ply >= sans.length) return finishPractice();
    board.setMovable(state.side);
    const k = state.ply;
    setStatus(state.ply === 0 ? `You play ${SIDE_NAME[state.side]}. Play the first move of the line.` : `The book move was ${Math.floor((k - 1) / 2) + 1}.${(k - 1) % 2 ? '..' : ''} ${sans[k - 1]}. Play the next move for ${SIDE_NAME[state.side]}.`);
  }
  function startPractice() {
    state.side = root.querySelector('input[name="op-side"]:checked').value;
    state.run++;
    state.mode = 'practice'; state.ply = 0; state.wrong = 0;
    board.setArrows([]); board.setHint([]);
    board.setOptions({ orientation: state.side });
    board.setPosition(positions[0]);
    $('.op-movelist').innerHTML = moveListHtml(0);
    root.querySelectorAll('[data-nav]').forEach((b) => { b.disabled = true; });
    setPracticeUi(true);
    botStep();
  }
  function stopPractice() {
    state.run++;
    state.mode = 'view'; state.ply = sans.length; state.busy = false;
    board.setMovable(null); board.setArrows([]); board.setHint([]);
    setPracticeUi(false);
    drawView();
  }
  function finishPractice() {
    state.mode = 'done';
    board.setMovable(null); board.setArrows([]);
    sound('correct');
    setPracticeUi(true, true);
    setStatus(state.wrong ? `You have played the whole line with ${state.wrong} wrong ${state.wrong === 1 ? 'attempt' : 'attempts'} on the way.` : 'You have played the whole line without a mistake.');
  }
  async function onMove(move) {
    if (state.mode !== 'practice' || state.busy || !userTurn()) return;
    const pos = positions[state.ply];
    const book = moves[state.ply];
    board.setArrows([]); board.setHint([]);
    const code = pos.moveCode(move);
    if (code === pos.moveCode(book)) {
      state.ply++;
      board.setPosition(positions[state.ply], { lastMove: book, animate: true });
      sound(soundForMove(book, positions[state.ply]));
      $('.op-movelist').innerHTML = moveListHtml(state.ply);
      return botStep();
    }
    state.wrong++;
    const san = code === -1 ? '' : pos.toSan(pos.codeToMove(code));
    sound('wrong');
    state.busy = true; board.setMovable(null);
    if (code !== -1) board.setPosition(pos.makeMove(move), { lastMove: move, animate: true });
    setStatus(`The move ${san} is playable, but it is not the move of this line. The position has been restored, so you can try again or select Show the move.`);
    const run = state.run;
    await new Promise((r) => setTimeout(r, 850));
    if (!root.isConnected || state.run !== run || state.mode !== 'practice') return;
    board.setPosition(pos, { lastMove: state.ply ? moves[state.ply - 1] : null });
    state.busy = false; board.setMovable(state.side);
  }

  root.querySelector('.op-view-tools').addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav && !nav.disabled) { const a = nav.dataset.nav; if (a === 'first') go(0); else if (a === 'last') go(sans.length); else go(state.ply + (a === 'next' ? 1 : -1)); return; }
    const mv = e.target.closest('.mv[data-ply]');
    if (mv && state.mode === 'view') go(+mv.dataset.ply);
  });
  root.querySelector('.op-practice').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pr]'); if (!b) return;
    const a = b.dataset.pr;
    if (a === 'start') startPractice();
    else if (a === 'stop') stopPractice();
    else if (a === 'show' && state.mode === 'practice' && userTurn()) {
      const m = moves[state.ply];
      board.setHint([m.from]); board.setArrows([{ from: m.from, to: m.to, kind: 'hint', piece: m.piece }]);
      setStatus(`The book move is ${sans[state.ply]}, shown by the arrow.`);
    } else if (a === 'bot') {
      const level = $('#op-level').value;
      updateSettings({ lastBotLevel: level });
      const { Game } = mods.engine;
      const g = new Game();
      for (const m of moves) g.play(m);
      app.pendingLoad = { target: 'play', record: { game: g.toJSON(), playerColor: state.side, botLevel: level, name: `Practice of the ${entry.name}` } };
      location.hash = '#/play';
    }
  });
  root.querySelectorAll('input[name="op-side"]').forEach((r) => r.addEventListener('change', () => { if (state.mode === 'view') { board.setOptions({ orientation: r.value }); } }));
  drawView();
  return () => { cleanup.forEach((f) => f()); cleanup = []; viewer = null; };
}

export function onKey(e) {
  if (!viewer) return false;
  if (e.key === 'ArrowLeft') { viewer.go(-1); return true; }
  if (e.key === 'ArrowRight') { viewer.go(1); return true; }
  if (e.key === 'Home') { viewer.first(); return true; }
  if (e.key === 'End') { viewer.last(); return true; }
  return false;
}
