// Separate from the analysis board. Pieces are placed freely here; Analyze
// hands the finished position to the normal analysis board.
import { esc, sqName, FILES, toast } from './dom.js';
import { pieceSvg, PIECE_NAMES, COLOR_NAMES } from './pieces.js';
import { CORNER, DIVIDER, ICONS } from './ornament.js';
import { onSettings, settings } from './state.js';
import {
  CASTLE_KEYS,
  castleAvailable,
  emptySetup,
  epCandidates,
  epSquares,
  moveSetupPiece,
  placePiece,
  setSetupCastle,
  setSetupEp,
  setSetupSide,
  setupFen,
  setupFromFen,
  setupProblems,
  startSetup,
} from '../setup-position.js';

const TYPES = ['k', 'q', 'r', 'b', 'n', 'p'];
const CASTLE_LABEL = {
  wK: 'White can castle kingside',
  wQ: 'White can castle queenside',
  bK: 'Black can castle kingside',
  bQ: 'Black can castle queenside',
};
const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;

function trayRow(color) {
  const name = color === 'w' ? 'White' : 'Black';
  return `<div class="editor-row" role="group" aria-label="${name} pieces">${TYPES.map((type) => `<button class="editor-piece" type="button" data-tray data-color="${color}" data-type="${type}" aria-label="${name} ${PIECE_NAMES[type]}" aria-pressed="false"></button>`).join('')}</div>`;
}

export function mountEditor(host, { fen, onAnalyze, onCancel }) {
  let state;
  try { state = setupFromFen(fen); } catch { state = startSetup(); }
  let tool = null;
  let selected = null;
  let orientation = settings().boardPerspective === 'b' ? 'b' : 'w';
  let pieceSet = settings().pieceSet || 'classic';

  host.innerHTML = `
    <div class="editor-layout">
      <div class="board-col">
        <div class="board-host">
          <div class="board-frame frame tight">${fc}
            <div class="board-coords files top" aria-hidden="true"></div>
            <div class="board-coords files bottom" aria-hidden="true"></div>
            <div class="board-coords ranks left" aria-hidden="true"></div>
            <div class="board-coords ranks right" aria-hidden="true"></div>
            <div class="board" role="grid" aria-label="Position editor. Drag a piece to another square, or drag it off the board to remove it."></div>
          </div>
        </div>
      </div>
      <aside class="side-col">
        <div class="frame panel">${fc}<div class="frame-inner">
          <h2>Set up a position</h2>
          ${DIVIDER}
          <p class="help">Choose a piece, then drag it onto a square or click the square. Drag a piece off the board, onto the bin, or right-click it to remove it.</p>
          <p class="editor-label">White pieces</p>
          ${trayRow('w')}
          <p class="editor-label">Black pieces</p>
          ${trayRow('b')}
          <div class="editor-row">
            <button class="editor-trash" type="button" data-trash aria-label="Remove a piece" aria-pressed="false" title="Drag a piece here, or select the bin and then click a piece">${ICONS.trash}<span>Remove</span></button>
          </div>
          <fieldset><legend>Side to move</legend>
            <div class="choice-row">
              <label class="choice"><input type="radio" name="editor-side" value="w"><span>White</span></label>
              <label class="choice"><input type="radio" name="editor-side" value="b"><span>Black</span></label>
            </div>
          </fieldset>
          <fieldset><legend>Castling is still allowed</legend>
            <div class="castle-grid">
              ${CASTLE_KEYS.map((key) => `<label class="toggle"><input type="checkbox" data-castle="${key}"><span>${CASTLE_LABEL[key]}</span></label>`).join('')}
            </div>
            <p class="help">A box can be ticked only while that king and rook are on their starting squares. Moving either piece clears it, and putting the piece back does not tick it again.</p>
          </fieldset>
          <p class="editor-label" id="editor-ep-label">En passant</p>
          <select id="editor-ep" class="field" aria-labelledby="editor-ep-label" aria-describedby="editor-ep-help"></select>
          <p class="help" id="editor-ep-help">Move a pawn two squares from its starting square, or pick the empty square it passed. Who is to move stays as you set it. The capture applies once that side is to move. You can also click that empty square. Clear it by choosing “No en passant capture”.</p>
          <div class="btn-row">
            <button class="btn small" type="button" data-editor="flip">${ICONS.flip}<span>Flip board</span></button>
            <button class="btn small" type="button" data-editor="start">${ICONS.retry}<span>Starting position</span></button>
            <button class="btn small" type="button" data-editor="clear">${ICONS.trash}<span>Clear board</span></button>
          </div>
          <label for="editor-fen">FEN</label>
          <input id="editor-fen" class="field" type="text" spellcheck="false" autocomplete="off">
          <div class="btn-row">
            <button class="btn small" type="button" data-editor="load">${ICONS.upload}<span>Load this FEN</span></button>
          </div>
          <p class="status editor-status" role="status"></p>
          <div class="btn-row">
            <button class="btn primary" type="button" data-editor="analyze">${ICONS.play}<span>Analyze</span></button>
            <button class="btn" type="button" data-editor="cancel">${ICONS.close}<span>Cancel</span></button>
          </div>
        </div></div>
      </aside>
    </div>`;

  const frame = host.querySelector('.board-frame');
  const boardEl = host.querySelector('.board');
  const cells = [];
  for (let r = 0; r < 8; r++) {
    const row = document.createElement('div');
    row.className = 'board-row';
    row.setAttribute('role', 'row');
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div');
      cell.className = 'sq';
      cell.setAttribute('role', 'gridcell');
      cell.tabIndex = -1;
      row.appendChild(cell);
      cells.push(cell);
    }
    boardEl.appendChild(row);
  }

  function layout() {
    cells.forEach((cell, i) => {
      const row = Math.floor(i / 8);
      const col = i % 8;
      const sq = orientation === 'w' ? (7 - row) * 8 + col : row * 8 + (7 - col);
      cell.dataset.sq = String(sq);
      cell.dataset.square = sqName(sq);
      cell.dataset.piece = '';
      cell.classList.toggle('light', ((sq & 7) + (sq >> 3)) % 2 === 1);
      cell.classList.toggle('dark', ((sq & 7) + (sq >> 3)) % 2 === 0);
    });
    const files = orientation === 'w' ? FILES.split('') : FILES.split('').reverse();
    const ranks = orientation === 'w' ? '87654321'.split('') : '12345678'.split('');
    host.querySelectorAll('.board-coords.files').forEach((el) => { el.innerHTML = files.map((f) => `<span>${f}</span>`).join(''); });
    host.querySelectorAll('.board-coords.ranks').forEach((el) => { el.innerHTML = ranks.map((r) => `<span>${r}</span>`).join(''); });
    frame.classList.toggle('no-coords', settings().showCoords === false);
  }

  function paint() {
    const problems = setupProblems(state);
    cells.forEach((cell) => {
      const sq = +cell.dataset.sq;
      const p = state.squares[sq];
      const key = p ? p.color + p.type : '';
      if (cell.dataset.piece !== key) {
        cell.dataset.piece = key;
        cell.innerHTML = p ? `<span class="piece">${pieceSvg(pieceSet, p.color, p.type)}</span>` : '';
      }
      cell.classList.toggle('selected', selected === sq);
      cell.classList.toggle('movable', !!p);
      cell.classList.toggle('ep-mark', state.ep === sq);
      const name = COLOR_NAMES[p ? p.color : 'w'];
      const epNote = state.ep === sq ? ', en passant' : '';
      cell.setAttribute('aria-label', p ? `${sqName(sq)}, ${name} ${PIECE_NAMES[p.type]}${epNote}` : `${sqName(sq)}, empty${epNote}`);
      const candidate = !p && epCandidates(state).some((c) => c.sq === sq);
      cell.title = candidate && !tool && state.ep !== sq ? 'Click to allow an en passant capture on this square.' : '';
    });
    host.querySelectorAll('[data-tray]').forEach((btn) => {
      const on = !!(tool && tool !== 'trash' && tool.color === btn.dataset.color && tool.type === btn.dataset.type);
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.innerHTML = pieceSvg(pieceSet, btn.dataset.color, btn.dataset.type);
    });
    const trash = host.querySelector('[data-trash]');
    trash.classList.toggle('is-selected', tool === 'trash');
    trash.setAttribute('aria-pressed', tool === 'trash' ? 'true' : 'false');
    host.querySelectorAll('input[name="editor-side"]').forEach((input) => { input.checked = input.value === state.side; });
    for (const key of CASTLE_KEYS) {
      const box = host.querySelector(`[data-castle="${key}"]`);
      const available = castleAvailable(state.squares, key);
      box.disabled = !available;
      box.checked = available && !!state.castle[key];
      box.title = available ? '' : 'That king and rook are not on their starting squares.';
    }
    const ep = host.querySelector('#editor-ep');
    const choices = epCandidates(state);
    const signature = choices.map((c) => c.sq).join(',');
    if (ep.dataset.choices !== signature) {
      ep.dataset.choices = signature;
      ep.innerHTML = `<option value="">No en passant capture</option>${choices.map((c) => `<option value="${c.sq}">${sqName(c.sq)}</option>`).join('')}`;
    }
    ep.value = choices.some((c) => c.sq === state.ep) ? String(state.ep) : '';
    const fenInput = host.querySelector('#editor-fen');
    if (document.activeElement !== fenInput) fenInput.value = setupFen(state);
    const status = host.querySelector('.editor-status');
    let epStatus = '';
    if (state.ep != null) {
      const where = sqName(state.ep);
      if (epSquares(state).includes(state.ep)) epStatus = `En passant is set on ${where}.`;
      else {
        const who = choices.find((c) => c.sq === state.ep).side === 'w' ? 'White' : 'Black';
        epStatus = `En passant is set on ${where}. It applies when ${who} is to move.`;
      }
    }
    status.textContent = problems[0] || epStatus || 'This position can be analyzed.';
    const analyze = host.querySelector('[data-editor="analyze"]');
    analyze.disabled = problems.length > 0;
    analyze.title = problems[0] || '';
  }

  function squareAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest ? el.closest('.sq') : null;
    if (!cell || !boardEl.contains(cell)) return null;
    return +cell.dataset.sq;
  }

  function onBoard(x, y) {
    const rect = boardEl.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  host.addEventListener('pointerdown', (event) => {
    if (event.button === 2) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (event.target.closest('input, textarea, select, label, a')) return;
    const action = event.target.closest('button');
    const tray = event.target.closest('[data-tray]');
    const trashBtn = event.target.closest('[data-trash]');
    const cell = event.target.closest('.sq');
    if (action && !tray && !trashBtn) return;
    if (!tray && !trashBtn && !cell) return;
    if (event.cancelable) event.preventDefault();
    const fromSq = cell && boardEl.contains(cell) ? +cell.dataset.sq : null;
    const start = {
      x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false, ghost: null,
      fromSq, fromTray: tray ? { color: tray.dataset.color, type: tray.dataset.type } : null,
      fromTrash: !!trashBtn,
    };
    let captured = false;
    try { host.setPointerCapture(event.pointerId); captured = true; } catch { /* the pointer can still be followed on window */ }
    const source = captured ? host : window;
    const end = (ev) => {
      if (ev.pointerId !== start.id) return;
      source.removeEventListener('pointermove', move);
      source.removeEventListener('pointerup', end);
      source.removeEventListener('pointercancel', end);
      try { host.releasePointerCapture(start.id); } catch { /* already released */ }
      cells.forEach((c) => c.classList.remove('drag-over'));
      host.querySelector('[data-trash]').classList.remove('is-drop');
      if (start.ghost) start.ghost.remove();
      const origin = boardEl.querySelector('.drag-origin');
      if (origin) origin.classList.remove('drag-origin');
      if (ev.type === 'pointercancel') return;
      if (!start.dragged) {
        if (start.fromTray) {
          const same = tool && tool !== 'trash' && tool.color === start.fromTray.color && tool.type === start.fromTray.type;
          tool = same ? null : start.fromTray;
          selected = null;
        } else if (start.fromTrash) {
          tool = tool === 'trash' ? null : 'trash';
          selected = null;
        } else if (start.fromSq != null) {
          if (tool === 'trash') state = placePiece(state, start.fromSq, null);
          else if (tool) state = placePiece(state, start.fromSq, tool);
          else if (selected != null && selected !== start.fromSq) {
            state = moveSetupPiece(state, selected, start.fromSq);
            selected = null;
          } else if (state.squares[start.fromSq]) selected = selected === start.fromSq ? null : start.fromSq;
          else if (selected == null && (state.ep === start.fromSq || epCandidates(state).some((c) => c.sq === start.fromSq))) {
            state = setSetupEp(state, state.ep === start.fromSq ? null : start.fromSq);
          } else selected = null;
        }
        paint();
        return;
      }
      const target = squareAt(ev.clientX, ev.clientY);
      const droppingOnTrash = !!(document.elementFromPoint(ev.clientX, ev.clientY) || { closest() { return null; } }).closest?.('[data-trash]');
      if (start.fromTray && target != null) state = placePiece(state, target, start.fromTray);
      else if (start.fromSq != null) {
        if (target != null) state = moveSetupPiece(state, start.fromSq, target);
        else if (droppingOnTrash || !onBoard(ev.clientX, ev.clientY)) state = placePiece(state, start.fromSq, null);
      }
      selected = null;
      paint();
    };
    const move = (ev) => {
      if (ev.pointerId !== start.id) return;
      if (!start.dragged && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 5) {
        const draggedPiece = start.fromTray || (start.fromSq != null ? state.squares[start.fromSq] : null);
        if (!draggedPiece) return;
        start.dragged = true;
        const size = cells[0].getBoundingClientRect().width || 48;
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.style.width = `${size}px`;
        ghost.style.height = `${size}px`;
        ghost.innerHTML = pieceSvg(pieceSet, draggedPiece.color, draggedPiece.type);
        document.body.appendChild(ghost);
        start.ghost = ghost;
        if (start.fromSq != null) {
          const origin = cells.find((c) => +c.dataset.sq === start.fromSq);
          const pieceEl = origin && origin.querySelector('.piece');
          if (pieceEl) pieceEl.classList.add('drag-origin');
        }
      }
      if (!start.dragged) return;
      if (ev.cancelable) ev.preventDefault();
      const size = cells[0].getBoundingClientRect().width || 48;
      start.ghost.style.transform = `translate(${ev.clientX - size / 2}px, ${ev.clientY - size / 2}px)`;
      const over = squareAt(ev.clientX, ev.clientY);
      cells.forEach((c) => c.classList.toggle('drag-over', over != null && +c.dataset.sq === over));
      const bin = host.querySelector('[data-trash]');
      const overBin = (document.elementFromPoint(ev.clientX, ev.clientY) || { closest() { return null; } }).closest?.('[data-trash]');
      bin.classList.toggle('is-drop', !!overBin || (start.fromSq != null && !onBoard(ev.clientX, ev.clientY) && over == null));
    };
    source.addEventListener('pointermove', move);
    source.addEventListener('pointerup', end);
    source.addEventListener('pointercancel', end);
  });

  boardEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const cell = event.target.closest('.sq');
    if (!cell || !state.squares[+cell.dataset.sq]) return;
    state = placePiece(state, +cell.dataset.sq, null);
    selected = null;
    paint();
  });

  host.addEventListener('change', (event) => {
    const t = event.target;
    if (t.name === 'editor-side') state = setSetupSide(state, t.value);
    else if (t.dataset.castle) state = setSetupCastle(state, t.dataset.castle, t.checked);
    else if (t.id === 'editor-ep') state = setSetupEp(state, t.value === '' ? null : +t.value);
    else return;
    paint();
  });

  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-editor]');
    if (!button || button.disabled) return;
    const act = button.dataset.editor;
    if (act === 'clear') { state = emptySetup(); tool = null; selected = null; }
    else if (act === 'start') { state = startSetup(); tool = null; selected = null; }
    else if (act === 'flip') { orientation = orientation === 'w' ? 'b' : 'w'; layout(); }
    else if (act === 'load') {
      try {
        state = setupFromFen(host.querySelector('#editor-fen').value.trim());
        tool = null;
        selected = null;
        toast('The position was loaded.');
      } catch (err) {
        toast(String(err && err.message || 'That FEN could not be loaded.').replace(/^Invalid FEN:\s*/, ''));
        return;
      }
    } else if (act === 'analyze') {
      const problems = setupProblems(state);
      if (problems.length) { toast(problems[0]); return; }
      onAnalyze(setupFen(state));
      return;
    } else if (act === 'cancel') { onCancel(); return; }
    paint();
  });

  const unsub = onSettings((next) => {
    pieceSet = next.pieceSet || 'classic';
    cells.forEach((cell) => { cell.dataset.piece = ''; });
    frame.classList.toggle('no-coords', next.showCoords === false);
    paint();
  });
  layout();
  paint();

  return {
    destroy() { unsub(); host.innerHTML = ''; },
    onKey(event) {
      if (event.key !== 'Escape') return false;
      onCancel();
      return true;
    },
  };
}
