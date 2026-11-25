// Analysis board: load a saved game, PGN or FEN, step through moves and read engine lines.
// Set up a position is a separate editor. It does not share the move-playing board.
import { mods } from './modules.js';
import { app } from './state.js';
import { GameController } from './gameview.js';
import { mountEditor } from './board-editor.js';
import { esc, toast } from './dom.js';
import { CORNER, ICONS } from './ornament.js';
import { attachStockfishEval } from './analysis-stockfish.js';

let editor = null;

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;

export function render(root) {
  const games = mods.storage.listGames();
  root.innerHTML = `
    <h1 class="page-title" id="title-analysis">Analysis</h1>
    <p class="lede">Load a position or a game, step through the moves, and read the engine's evaluation. The evaluation bar and the suggested lines on this page are produced by the bundled Stockfish engine. You can also play moves from any position to explore alternatives.</p>
    <p class="setup-entry"><button class="btn" type="button" data-load="setup" aria-expanded="false">${ICONS.pen}<span>Set up a position</span></button></p>
    <details class="frame load-panel" ${app.controllers.analysis ? '' : 'open'}>${fc}
      <summary class="engraved">Load a game or position</summary>
      <div class="frame-inner load-grid">
        <div><label for="an-saved">Saved game</label><select id="an-saved" class="field"><option value="">Select a saved game</option>${games.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select>
          <button class="btn small" type="button" data-load="saved" ${games.length ? '' : 'disabled title="There are no saved games."'}>${ICONS.upload}<span>Load the saved game</span></button></div>
        <div><label for="an-fen">FEN position</label><input id="an-fen" class="field" type="text" spellcheck="false" autocomplete="off" placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1">
          <button class="btn small" type="button" data-load="fen">${ICONS.upload}<span>Load the FEN</span></button>
          <button class="btn small" type="button" data-load="start">${ICONS.retry}<span>Start from the initial position</span></button></div>
        <div class="span2"><label for="an-pgn">PGN text</label><textarea id="an-pgn" class="field" rows="4" spellcheck="false" placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5 a6"></textarea>
          <button class="btn small" type="button" data-load="pgn">${ICONS.upload}<span>Load the PGN</span></button>
          <p class="fen-out muted"></p></div>
      </div>
    </details>
    <div class="editor-host" hidden></div>
    <div class="game-host"></div>`;
  const host = root.querySelector('.game-host');
  const editorHost = root.querySelector('.editor-host');
  const setupBtn = root.querySelector('[data-load="setup"]');
  const fenOut = root.querySelector('.fen-out');

  const attach = (ctrl) => {
    if (app.controllers.analysis && app.controllers.analysis !== ctrl) app.controllers.analysis.destroy();
    app.controllers.analysis = ctrl;
    ctrl.onChange = () => showFen(ctrl);
    if (ctrl._sfDetach) { ctrl._sfDetach(); ctrl._sfDetach = null; }
    ctrl.mount(host);
    ctrl._sfDetach = attachStockfishEval(ctrl);
    window.__chess.controller = ctrl;
    showFen(ctrl);
    if (!ctrl._fenHooked) {
      ctrl._fenHooked = true;
      const origGoto = ctrl.goto.bind(ctrl);
      ctrl.goto = (p) => { origGoto(p); if (ctrl.onChange) ctrl.onChange(ctrl); };
    }
  };
  const showFen = (ctrl) => { fenOut.textContent = `Position shown: ${ctrl.position.toFen()}`; };
  const fromGame = (game, name, orientation) => { const c = new GameController({ mode: 'analysis', game, name }); if (orientation) c.orientation = orientation; return c; };

  const closeEditor = () => {
    if (editor) { editor.destroy(); editor = null; }
    editorHost.hidden = true;
    host.hidden = false;
    setupBtn.setAttribute('aria-expanded', 'false');
  };
  const openEditor = () => {
    if (editor) return;
    const ctrl = app.controllers.analysis;
    let fen;
    try { fen = ctrl && ctrl.position ? ctrl.position.toFen() : undefined; } catch { fen = undefined; }
    if (ctrl) {
      if (ctrl._sfDetach) { ctrl._sfDetach(); ctrl._sfDetach = null; }
      ctrl.unmount();
    }
    host.innerHTML = '';
    host.hidden = true;
    editorHost.hidden = false;
    const panel = root.querySelector('.load-panel');
    if (panel) panel.open = false;
    setupBtn.setAttribute('aria-expanded', 'true');
    editor = mountEditor(editorHost, {
      fen,
      onAnalyze(nextFen) {
        closeEditor();
        try {
          attach(fromGame(new mods.engine.Game(nextFen), 'Set up position'));
          toast('The position was loaded.');
        } catch (err) {
          toast(`The position could not be loaded: ${err.message}`);
          attach(fromGame(new mods.engine.Game(), ''));
        }
      },
      onCancel() {
        closeEditor();
        const current = app.controllers.analysis;
        if (current) attach(current);
        else attach(fromGame(new mods.engine.Game(), ''));
      },
    });
  };

  const pending = app.pendingLoad && app.pendingLoad.target === 'analysis' ? app.pendingLoad : null;
  if (pending) {
    app.pendingLoad = null;
    try {
      const c = fromGame(mods.engine.Game.fromJSON(pending.record.game), pending.record.name, pending.record.mode === 'bot' || pending.record.mode === 'online' ? pending.record.playerColor : 'w');
      attach(c); root.querySelector('.load-panel').open = false;
    } catch (err) { toast(`The game could not be loaded: ${err.message}`); }
  } else if (app.controllers.analysis) attach(app.controllers.analysis);
  else attach(fromGame(new mods.engine.Game(), ''));

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-load]'); if (!b || b.disabled) return;
    if (b.dataset.load === 'setup') { openEditor(); return; }
    closeEditor();
    const { Game } = mods.engine;
    try {
      if (b.dataset.load === 'saved') {
        const id = root.querySelector('#an-saved').value; if (!id) { toast('Select a saved game first.'); return; }
        const rec = mods.storage.loadGame(id);
        attach(fromGame(Game.fromJSON(rec.game), rec.name, rec.mode === 'bot' || rec.mode === 'online' ? rec.playerColor : 'w'));
      } else if (b.dataset.load === 'fen') {
        const fen = root.querySelector('#an-fen').value.trim(); if (!fen) { toast('Enter a FEN position first.'); return; }
        attach(fromGame(new Game(fen), 'Position from FEN'));
      } else if (b.dataset.load === 'start') attach(fromGame(new Game(), ''));
      else if (b.dataset.load === 'pgn') {
        const text = root.querySelector('#an-pgn').value; if (!text.trim()) { toast('Paste PGN text first.'); return; }
        const g = Game.fromPgn(text);
        attach(fromGame(g, (text.match(/\[Event "([^"]*)"\]/) || [])[1] || 'Game from PGN'));
      }
      toast('The position was loaded.');
    } catch (err) { toast(`The input could not be loaded: ${err.message}`); }
  });
  return () => {
    if (editor) { editor.destroy(); editor = null; }
    const c = app.controllers.analysis;
    if (c) { if (c._sfDetach) { c._sfDetach(); c._sfDetach = null; } c.unmount(); }
  };
}

export function onKey(e) {
  if (editor && editor.onKey(e)) return true;
  const c = app.controllers.analysis;
  return c && c.root ? c.handleKey(e) : false;
}
