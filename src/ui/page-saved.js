// Saved games: list, load, rename, delete, import and export.
import { mods } from './modules.js';
import { app, difficulty } from './state.js';
import { esc, formatDate, toast, download, copyText, safeFileName, describeResult } from './dom.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { confirmDialog, promptDialog } from './dialogs.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const MODE_TEXT = { bot: 'Game against the bot', local: 'Two-player game', puzzle: 'Puzzle', analysis: 'Analysis', online: 'Online game' };

function summary(rec) {
  const n = (rec.game && rec.game.uci && rec.game.uci.length) || rec.plyCount || 0;
  const res = rec.game && rec.game.resultInfo;
  let s = `${MODE_TEXT[rec.mode] || 'Game'}${rec.mode === 'bot' && rec.botLevel ? ` at the ${difficulty(rec.botLevel).name} level, playing ${rec.playerColor === 'b' ? 'Black' : 'White'}` : ''}. ${n} ${n === 1 ? 'move' : 'moves'}. `;
  s += res ? describeResult(res) : 'The game is not finished.';
  return s;
}

// Opening of a saved record, or null. Uses the full move list of the game.
function savedOpening(rec) {
  const o = mods.openings;
  if (!o || !rec.game || !Array.isArray(rec.game.uci) || !rec.game.uci.length) return null;
  if (rec.game.startFen && rec.game.startFen !== mods.engine.START_FEN) return null;
  try { return o.identifyOpening(rec.game.uci); } catch { return null; }
}

export function render(root) {
  root.innerHTML = `
    <h1 class="page-title" id="title-saved">Saved games</h1>
    <p class="lede">Games are stored in this browser. You can load a game to continue it or to analyse it, and you can move games between devices with export and import.</p>
    <div class="frame import-card">${fc}<div class="frame-inner">
      <h2>Import a game</h2>
      <p>Select a game file exported from this application, or a PGN file. You can also paste PGN text below.</p>
      <div class="btn-row">
        <label class="btn file-btn">${ICONS.upload}<span>Import a file</span><input type="file" accept=".json,.pgn,.txt,application/json" class="sr-only" data-act="file" aria-label="Import a game file"></label>
        <button class="btn" type="button" data-act="paste">${ICONS.copy}<span>Paste PGN text</span></button>
      </div>
    </div></div>
    ${DIVIDER}
    <div class="saved-list" aria-live="polite"></div>`;
  const listEl = root.querySelector('.saved-list');

  const draw = () => {
    const games = mods.storage.listGames().map((g) => mods.storage.loadGame(g.id) || g).slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    window.__chess.savedCount = games.length;
    if (!games.length) { listEl.innerHTML = '<p class="muted center">There are no saved games yet. Save a game from the Play, Two players or Analysis pages, or import one above.</p>'; return; }
    listEl.innerHTML = `<p class="muted">${games.length} ${games.length === 1 ? 'game is' : 'games are'} saved.</p><ul class="saved-games">` + games.map((g) => `
      <li class="saved-item frame tight" data-id="${esc(g.id)}">${fc}<div class="frame-inner">
        <h3 class="saved-name">${esc(g.name)}</h3>
        <p class="muted">Saved on ${esc(formatDate(g.savedAt))}. ${esc(summary(g))}</p>
        ${(() => { const op = savedOpening(g); return op ? `<p class="saved-opening"><abbr class="ob-eco" title="Encyclopaedia of Chess Openings code">${esc(op.eco)}</abbr><span>${esc(op.name)}</span></p>` : ''; })()}
        <div class="btn-row">
          ${(g.mode === 'bot' || g.mode === 'local') && !(g.game && g.game.resultInfo) ? `<button class="btn primary small" type="button" data-act="continue">${ICONS.play}<span>Continue</span></button>` : ''}
          <button class="btn small" type="button" data-act="analyse">${ICONS.next}<span>Analyse</span></button>
          ${(g.game && g.game.uci && g.game.uci.length) ? `<button class="btn small" type="button" data-act="review">${ICONS.play}<span>Review</span></button>` : ''}
          <button class="btn small" type="button" data-act="rename" aria-label="Rename ${esc(g.name)}">${ICONS.pen}<span>Rename</span></button>
          <button class="btn small" type="button" data-act="export" aria-label="Export ${esc(g.name)} as a file">${ICONS.download}<span>Export file</span></button>
          <button class="btn small" type="button" data-act="pgncopy" aria-label="Copy the PGN of ${esc(g.name)}">${ICONS.copy}<span>Copy PGN</span></button>
          <button class="btn small" type="button" data-act="pgnfile" aria-label="Download the PGN of ${esc(g.name)}">${ICONS.download}<span>Download PGN</span></button>
          <button class="btn small danger" type="button" data-act="delete" aria-label="Delete ${esc(g.name)}">${ICONS.trash}<span>Delete</span></button>
        </div></div></li>`).join('') + '</ul>';
  };

  const importText = (text, filename = '') => {
    const st = mods.storage;
    let rec;
    const looksJson = /^\s*[{[]/.test(text);
    try { rec = looksJson ? st.importGameFile(text) : st.importPgn(text); } catch (err) { toast(`The game could not be imported: ${err.message}`); return; }
    if (!rec.name) rec.name = filename.replace(/\.[^.]+$/, '') || 'Imported game';
    delete rec.id;
    rec.savedAt = Date.now();
    try { st.saveGame(rec); toast(`The game "${rec.name}" was imported.`); } catch (err) { toast(`The game could not be saved: ${err.message}`); }
    draw();
  };

  root.addEventListener('change', async (e) => {
    if (e.target.matches('[data-act="file"]')) {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      importText(await f.text(), f.name);
      e.target.value = '';
    }
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'paste') {
      const text = await promptDialog('Paste PGN text', 'Paste the PGN of one game. Comments and variations are accepted, and variations are skipped.', '', { ok: 'Import', multiline: true });
      if (text && text.trim()) importText(text);
      return;
    }
    const item = b.closest('[data-id]'); if (!item) return;
    const id = item.dataset.id;
    const rec = mods.storage.loadGame(id); if (!rec) { toast('The game was not found.'); draw(); return; }
    if (act === 'continue') { app.pendingLoad = { target: rec.mode === 'local' ? 'local' : 'play', record: rec }; location.hash = rec.mode === 'local' ? '#/local' : '#/play'; }
    else if (act === 'analyse') { app.pendingLoad = { target: 'analysis', record: rec }; location.hash = '#/analysis'; }
    else if (act === 'review') { app.pendingLoad = { target: 'review', record: rec }; location.hash = '#/review'; }
    else if (act === 'rename') {
      const name = await promptDialog('Rename the game', 'Enter a new name for this game.', rec.name, { ok: 'Rename' });
      if (name && name.trim()) { try { mods.storage.renameGame(id, name.trim()); toast('The game was renamed.'); } catch (err) { toast(err.message); } draw(); }
    } else if (act === 'delete') {
      if (await confirmDialog('Delete the game', `The game "${rec.name}" will be deleted permanently. Do you want to continue?`, { ok: 'Delete', danger: true })) { mods.storage.deleteGame(id); toast('The game was deleted.'); draw(); }
    } else if (act === 'export') download(safeFileName(rec.name) + '.json', mods.storage.exportGameFile(rec), 'application/json');
    else if (act === 'pgncopy') toast((await copyText(mods.storage.exportPgn(rec))) ? 'The PGN was copied to the clipboard.' : 'The PGN could not be copied.');
    else if (act === 'pgnfile') download(safeFileName(rec.name) + '.pgn', mods.storage.exportPgn(rec), 'application/x-chess-pgn');
  });
  draw();
}
