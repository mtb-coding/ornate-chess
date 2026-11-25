// Interactive board view. It renders a Position, reports chosen moves through
// onMove, and never decides legality itself: legal moves come from the
// position object supplied by engine.js.
import { esc, sqName, FILES } from './dom.js';
import { pieceSvg, PIECE_NAMES, COLOR_NAMES } from './pieces.js';
import { promotionDialog } from './dialogs.js';
import { CORNER } from './ornament.js';
import { Annotations, ANNOTATION_COLORS, colorForModifiers, arrowPathD, engineArrowGeometry } from './annotations.js';
import { badgeSvg } from './review-badges.js';
import { premoveMoves } from '../premove.js';

export class Board {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = { pieceSet: 'classic', orientation: 'w', showLegal: true, showCoords: true, animations: true, autoQueen: false, label: 'Chess board', ...opts };
    this.position = null;
    this.lastMove = null;
    this.selected = null;
    this.legalTargets = [];
    this.movable = null; // 'w' | 'b' | 'both' | null
    this.hintSquares = [];
    this.arrows = [];
    this.ghosts = [];
    this.reviewBadge = null; // { sq, judgment }
    this.annotations = new Annotations();
    this.annotPreview = null; // { from, to, color } while the right button is held
    this.focusSq = null;
    this.drag = null;
    this.busy = false;
    this.onMove = opts.onMove || (() => {});
    this.onPremove = opts.onPremove || null;
    this.onClearPremoves = opts.onClearPremoves || null;
    this.premoveColor = null;
    this.premoveBoard = null;
    this.premoveMarks = [];
    this.premoveEnabled = false;
    this.build();
  }

  build() {
    this.host.innerHTML = `<div class="board-frame frame tight"><span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>
      <div class="board-coords files top" aria-hidden="true"></div><div class="board-coords files bottom" aria-hidden="true"></div>
      <div class="board-coords ranks left" aria-hidden="true"></div><div class="board-coords ranks right" aria-hidden="true"></div>
      <div class="board" role="grid" aria-label="${esc(this.opts.label)}"></div>
      <svg class="board-arrows" viewBox="0 0 800 800" aria-hidden="true" focusable="false"><defs><marker id="ah-${this._uid = Math.random().toString(36).slice(2, 7)}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="currentColor"/></marker><marker id="ah-s-${this._uid}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="rgb(120, 170, 92)"/></marker><marker id="ah-t-${this._uid}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="rgb(196, 84, 66)"/></marker></defs><filter id="af-${this._uid}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dy="2" result="b"/><feComponentTransfer><feFuncA type="linear" slope=".45"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><g class="annot-layer" filter="url(#af-${this._uid})"></g><g class="arrow-layer"></g></svg>
    </div>`;
    this.frameEl = this.host.querySelector('.board-frame');
    this.boardEl = this.host.querySelector('.board');
    this.arrowLayer = this.host.querySelector('.arrow-layer');
    this.annotLayer = this.host.querySelector('.annot-layer');
    this._arrowHtml = ''; this._annotHtml = ''; this._badgeEl = null;
    this.squares = new Array(64);
    for (let r = 0; r < 8; r++) {
      const row = document.createElement('div');
      row.className = 'board-row'; row.setAttribute('role', 'row');
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement('div');
        cell.className = 'sq'; cell.setAttribute('role', 'gridcell'); cell.tabIndex = -1;
        row.appendChild(cell);
      }
      this.boardEl.appendChild(row);
    }
    this.cells = Array.from(this.boardEl.querySelectorAll('.sq'));
    this.boardEl.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.boardEl.addEventListener('keydown', (e) => this.keyDown(e));
    this.boardEl.addEventListener('focusin', (e) => { const sq = this.sqOfEl(e.target); if (sq != null) this.focusSq = sq; });
    this.boardEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.premoveMarks.length && this.onClearPremoves) this.onClearPremoves();
    });
    this.layout();
  }

  // Maps display index (0 = top-left cell) to square number.
  cellSquare(i) {
    const row = Math.floor(i / 8), col = i % 8;
    return this.opts.orientation === 'w' ? (7 - row) * 8 + col : row * 8 + (7 - col);
  }
  squareCell(sq) {
    const f = sq & 7, r = sq >> 3;
    return this.opts.orientation === 'w' ? (7 - r) * 8 + f : r * 8 + (7 - f);
  }
  sqOfEl(t) { const c = t && t.closest && t.closest('.sq'); return c ? +c.dataset.sq : null; }

  layout() {
    this.cells.forEach((cell, i) => {
      const sq = this.cellSquare(i);
      cell.dataset.sq = sq; cell.dataset.square = sqName(sq);
      cell.classList.toggle('light', ((sq & 7) + (sq >> 3)) % 2 === 1);
      cell.classList.toggle('dark', ((sq & 7) + (sq >> 3)) % 2 === 0);
    });
    const files = this.opts.orientation === 'w' ? FILES.split('') : FILES.split('').reverse();
    const ranks = this.opts.orientation === 'w' ? '87654321'.split('') : '12345678'.split('');
    this.host.querySelectorAll('.board-coords.files').forEach((e) => { e.innerHTML = files.map((f) => `<span>${f}</span>`).join(''); });
    this.host.querySelectorAll('.board-coords.ranks').forEach((e) => { e.innerHTML = ranks.map((r) => `<span>${r}</span>`).join(''); });
    this.frameEl.classList.toggle('no-coords', !this.opts.showCoords);
    if (this.position) this.render();
  }

  setOptions(patch) {
    const relayout = 'orientation' in patch && patch.orientation !== this.opts.orientation || 'showCoords' in patch;
    Object.assign(this.opts, patch);
    if (relayout) this.layout(); else if (this.position) this.render();
  }
  flip() { this.setOptions({ orientation: this.opts.orientation === 'w' ? 'b' : 'w' }); }

  setMovable(m) { this.movable = m; if (!m) this.clearSelection(); this.updateFocusable(); }

  setPosition(position, { lastMove = null, animate = false } = {}) {
    const prev = this.position;
    // Annotations belong to the position on screen, so a new position clears them.
    if (!prev || !position || prev !== position && prev.toFen() !== position.toFen()) { this.annotations.clear(); this.annotPreview = null; }
    this.position = position;
    this.lastMove = lastMove;
    this.ghosts = [];
    this.premoveColor = null;
    this.premoveBoard = null;
    this.premoveMarks = [];
    this.premoveEnabled = false;
    this.clearSelection(false);
    this.hintSquares = [];
    this.render();
    if (animate && lastMove && prev && this.opts.animations && !matchMedia('(prefers-reduced-motion: reduce)').matches) this.animate(lastMove);
  }

  // Sets the position together with its decorations in a single render, so a
  // review step paints the board once instead of once per decoration.
  setView(position, { lastMove = null, ghosts = [], arrows = [], badge = null } = {}) {
    const prev = this.position;
    if (!prev || !position || prev !== position && prev.toFen() !== position.toFen()) { this.annotations.clear(); this.annotPreview = null; }
    this.position = position;
    this.lastMove = lastMove;
    this.ghosts = ghosts || [];
    this.arrows = arrows || [];
    this.reviewBadge = badge && badge.sq != null && badge.judgment ? { sq: badge.sq, judgment: badge.judgment } : null;
    this.selected = null; this.legalTargets = [];
    this.hintSquares = [];
    this.render();
  }

  // `spec` is { color, board, marks, enabled }. Null clears the preview.
  setPremove(spec) {
    if (!spec) {
      const had = this.premoveColor || this.premoveMarks.length;
      this.premoveColor = null;
      this.premoveBoard = null;
      this.premoveMarks = [];
      this.premoveEnabled = false;
      if (had && this.position) this.render();
      return;
    }
    this.premoveColor = spec.color;
    this.premoveBoard = spec.board;
    this.premoveMarks = spec.marks || [];
    this.premoveEnabled = spec.enabled !== false;
    if (this.position) this.render();
  }

  setHint(squares) { this.hintSquares = squares || []; this.render(); }
  setArrows(arrows) { this.arrows = arrows || []; this.drawArrows(); }
  setGhosts(ghosts) { this.ghosts = ghosts || []; this.render(); }

  clearAnnotations() { if (this.annotations.clear() || this.annotPreview) { this.annotPreview = null; this.render(); } }

  clearSelection(rerender = true) { this.selected = null; this.legalTargets = []; if (rerender && this.position) this.render(); }

  premoveActive() {
    return !!(this.premoveColor && this.premoveBoard && this.position && this.position.turn !== this.premoveColor);
  }

  canPick(sq) {
    if (!this.position || this.busy) return false;
    if (this.premoveActive()) {
      if (!this.premoveEnabled) return false;
      const piece = this.premoveBoard[sq];
      return !!(piece && piece.color === this.premoveColor && premoveMoves(this.premoveBoard, this.premoveColor, sq).length);
    }
    if (!this.movable) return false;
    const pc = this.position.board[sq];
    if (!pc || pc.color !== this.position.turn) return false;
    return this.movable === 'both' || this.movable === pc.color;
  }

  select(sq) {
    this.selected = sq;
    if (this.premoveActive()) this.legalTargets = premoveMoves(this.premoveBoard, this.premoveColor, sq);
    else this.legalTargets = this.position.legalMovesFrom(sq);
    this.render();
  }

  render() {
    const pos = this.position; if (!pos) return;
    const preview = this.premoveBoard;
    const realCheck = pos.inCheck() ? pos.board.findIndex((p) => p && p.type === 'k' && p.color === pos.turn) : -1;
    const checkSq = realCheck >= 0 && (!preview || (preview[realCheck] && preview[realCheck].type === 'k' && preview[realCheck].color === pos.turn)) ? realCheck : -1;
    const targets = new Set(this.legalTargets.map((m) => m.to));
    const premoves = new Set(this.premoveMarks);
    for (let i = 0; i < 64; i++) {
      const cell = this.cells[i]; const sq = +cell.dataset.sq; const pc = preview ? preview[sq] : pos.board[sq];
      const cls = cell.classList;
      cls.toggle('last', !!this.lastMove && (this.lastMove.from === sq || this.lastMove.to === sq));
      cls.toggle('premove', premoves.has(sq));
      cls.toggle('check', sq === checkSq);
      cls.toggle('selected', sq === this.selected);
      cls.toggle('target', targets.has(sq) && this.opts.showLegal);
      cls.toggle('capture-target', targets.has(sq) && !!pc && this.opts.showLegal);
      cls.toggle('hint', this.hintSquares.includes(sq));
      cls.toggle('movable', this.canPick(sq));
      const mark = this.annotations.highlights.get(sq);
      cls.toggle('annot', !!mark);
      if (mark) { cell.dataset.annot = mark; cell.style.setProperty('--annot', ANNOTATION_COLORS[mark].square); } else if (cell.dataset.annot) { delete cell.dataset.annot; cell.style.removeProperty('--annot'); }
      const ghost = (!pc && this.ghosts) ? this.ghosts.find((g) => g.sq === sq) : null;
      const key = pc
        ? `${this.opts.pieceSet}-${pc.color}${pc.type}`
        : (ghost ? `ghost-${this.opts.pieceSet}-${ghost.color}${ghost.type}` : '');
      if (cell.dataset.piece !== key) {
        cell.dataset.piece = key;
        if (pc) {
          cell.innerHTML = `<div class="piece" data-color="${pc.color}" data-type="${pc.type}">${pieceSvg(this.opts.pieceSet, pc.color, pc.type)}</div>`;
        } else if (ghost) {
          cell.innerHTML = `<div class="piece ghost" data-color="${ghost.color}" data-type="${ghost.type}" aria-hidden="true">${pieceSvg(this.opts.pieceSet, ghost.color, ghost.type)}</div>`;
        } else {
          cell.innerHTML = '';
        }
      }
      let label = `${sqName(sq)}, ${pc ? `${COLOR_NAMES[pc.color]} ${PIECE_NAMES[pc.type]}` : 'empty'}`;
      if (sq === this.selected) label += ', selected';
      if (targets.has(sq)) label += ', legal move';
      if (sq === checkSq) label += ', in check';
      if (this.lastMove && this.lastMove.to === sq) label += ', last move';
      if (premoves.has(sq)) label += ', premove';
      if (mark) label += `, highlighted in ${ANNOTATION_COLORS[mark].label.toLowerCase()}`;
      if (cell._label !== label) { cell._label = label; cell.setAttribute('aria-label', label); }
      const selAttr = sq === this.selected ? 'true' : 'false';
      if (cell._sel !== selAttr) { cell._sel = selAttr; cell.setAttribute('aria-selected', selAttr); }
    }
    this.updateFocusable();
    this.drawArrows();
    this.paintReviewBadge();
  }

  updateFocusable() {
    let f = this.focusSq;
    if (f == null) f = this.opts.orientation === 'w' ? 12 : 52;
    this.cells.forEach((c) => { const t = +c.dataset.sq === f ? 0 : -1; if (c.tabIndex !== t) c.tabIndex = t; });
  }

  drawAnnotations() {
    if (!this.annotLayer) return;
    const o = this.opts.orientation;
    const list = this.annotations.arrows.slice();
    const p = this.annotPreview;
    if (p && p.to != null && p.to !== p.from) {
      const i = list.findIndex((a) => a.from === p.from && a.to === p.to);
      if (i >= 0) list.splice(i, 1);
      list.push({ ...p, preview: true });
    }
    const html = list.map((a) => `<path class="annot-arrow${a.preview ? ' preview' : ''}" data-from="${sqName(a.from)}" data-to="${sqName(a.to)}" data-color="${a.color}" fill="${ANNOTATION_COLORS[a.color].fill}" d="${arrowPathD(a.from, a.to, o)}"/>`).join('');
    // Replacing the layer's markup re-parses and repaints it, so skip it when nothing changed.
    if (this._annotHtml !== html) { this._annotHtml = html; this.annotLayer.innerHTML = html; }
  }

  drawArrows() {
    this.drawAnnotations();
    const o = this.opts.orientation;
    const html = this.arrows.map((a) => {
      const geo = engineArrowGeometry(a.from, a.to, o, { piece: a.piece });
      const mid = a.kind === 'suggest' ? `ah-s-${this._uid}` : a.kind === 'threat' ? `ah-t-${this._uid}` : `ah-${this._uid}`;
      return `<path class="arrow ${a.kind || ''}${geo.knight ? ' knight' : ''}" data-from="${sqName(a.from)}" data-to="${sqName(a.to)}" data-knight="${geo.knight ? '1' : '0'}" d="${geo.d}" fill="none" marker-end="url(#${mid})"/>`;
    }).join('');
    if (this._arrowHtml !== html) { this._arrowHtml = html; this.arrowLayer.innerHTML = html; }
  }

  setReviewBadge(sq, judgment) {
    this.reviewBadge = (sq == null || sq === false || !judgment) ? null : { sq, judgment };
    this.paintReviewBadge();
  }

  paintReviewBadge() {
    if (!this.cells) return;
    const want = this.reviewBadge;
    const c = want ? this.cells[this.squareCell(want.sq)] : null;
    const cur = this._badgeEl;
    // Keep the existing badge when it is still on the right cell with the same judgment.
    if (cur && c && cur.parentNode === c && cur.dataset.judgment === want.judgment) return;
    if (cur && cur.parentNode) cur.remove();
    this._badgeEl = null;
    if (!want || !c) return;
    const { judgment } = want;
    const wrap = document.createElement('span');
    wrap.className = `review-badge j-${judgment}`;
    wrap.dataset.judgment = judgment;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = badgeSvg(judgment);
    c.appendChild(wrap);
    this._badgeEl = wrap;
  }

  animate(m) {
    const slide = (from, to) => {
      const el = this.cells[this.squareCell(to)].querySelector('.piece'); if (!el) return;
      const a = this.squareCell(from), b = this.squareCell(to);
      const dx = (a % 8) - (b % 8), dy = Math.floor(a / 8) - Math.floor(b / 8);
      el.style.transition = 'none';
      el.style.transform = `translate(${dx * 100}%, ${dy * 100}%)`;
      el.classList.add('sliding');
      el.getBoundingClientRect();
      el.style.transition = '';
      el.style.transform = '';
      setTimeout(() => el.classList.remove('sliding'), 260);
    };
    slide(m.from, m.to);
    if (m.flags && m.flags.includes('k')) slide(m.to + 1, m.to - 1);
    if (m.flags && m.flags.includes('q')) slide(m.to - 2, m.to + 1);
  }

  async tryTarget(to) {
    const from = this.selected;
    const cands = this.legalTargets.filter((m) => m.to === to);
    if (!cands.length) return false;
    let move = cands[0];
    if (cands.length > 1 || move.promotion) {
      let choice = 'q';
      if (!this.opts.autoQueen) {
        this.busy = true;
        const carrier = (this.premoveBoard && this.premoveBoard[from]) || this.position.board[from];
        choice = await promotionDialog(carrier ? carrier.color : this.position.turn, this.opts.pieceSet);
        this.busy = false;
      }
      if (!choice) { this.clearSelection(); this.focusCell(from); return true; }
      move = cands.find((m) => m.promotion === choice) || cands[0];
    }
    this.clearSelection(false);
    this.focusSq = to;
    if (this.premoveActive() && this.onPremove) this.onPremove(move);
    else this.onMove(move);
    return true;
  }

  async activate(sq) {
    if (this.selected != null && this.legalTargets.some((m) => m.to === sq)) { await this.tryTarget(sq); return; }
    if (this.selected === sq) { this.clearSelection(); return; }
    if (this.canPick(sq)) this.select(sq);
    else if (this.selected != null) this.clearSelection();
  }

  squareAtPoint(x, y) {
    const r = this.boardEl.getBoundingClientRect();
    if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
    const col = Math.floor(((x - r.left) / r.width) * 8), row = Math.floor(((y - r.top) / r.height) * 8);
    return this.cellSquare(row * 8 + col);
  }

  // Right button: highlight a square or draw an arrow (mouse and pen only).
  annotateDown(e) {
    const from = this.sqOfEl(e.target); if (from == null) return;
    e.preventDefault();
    let captured = false;
    try { this.boardEl.setPointerCapture(e.pointerId); captured = true; } catch (_) {}
    const source = captured ? this.boardEl : window;
    this.annotPreview = { from, to: from, color: colorForModifiers(e) };
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId || !this.annotPreview) return;
      const over = this.squareAtPoint(ev.clientX, ev.clientY);
      const color = colorForModifiers(ev);
      if (over !== this.annotPreview.to || color !== this.annotPreview.color) { this.annotPreview = { from, to: over, color }; this.drawAnnotations(); }
    };
    const end = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      source.removeEventListener('pointermove', move);
      source.removeEventListener('pointerup', end);
      source.removeEventListener('pointercancel', end);
      try { if (captured && this.boardEl.hasPointerCapture(ev.pointerId)) this.boardEl.releasePointerCapture(ev.pointerId); } catch (_) {}
      this.annotPreview = null;
      if (ev.type !== 'pointercancel') {
        const to = this.squareAtPoint(ev.clientX, ev.clientY);
        const color = colorForModifiers(ev);
        if (to === from) this.annotations.toggleHighlight(from, color);
        else if (to != null) this.annotations.toggleArrow(from, to, color);
      }
      this.render();
      if (this.onAnnotate) this.onAnnotate(this.annotations.snapshot());
    };
    source.addEventListener('pointermove', move);
    source.addEventListener('pointerup', end);
    source.addEventListener('pointercancel', end);
  }

  pointerDown(e) {
    if (e.button === 2) {
      if (this.premoveMarks.length && this.onClearPremoves) {
        e.preventDefault();
        this.onClearPremoves();
        return;
      }
      if (e.pointerType !== 'touch') this.annotateDown(e);
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // A left click anywhere on the board clears the annotations, as on Chess.com.
    if (e.pointerType !== 'touch' && !this.annotations.isEmpty) this.clearAnnotations();
    const sq = this.sqOfEl(e.target); if (sq == null || this.busy) return;
    // Prevent scrolling and double-tap zoom while interacting with the board.
    if (e.cancelable) e.preventDefault();
    const pickable = this.canPick(sq);
    const start = { x: e.clientX, y: e.clientY, sq, id: e.pointerId, started: false, ghost: null, wasSelected: this.selected === sq, done: false };
    let captured = false;
    try { this.boardEl.setPointerCapture(e.pointerId); captured = true; } catch (_) {}
    const source = captured ? this.boardEl : window;
    const move = (ev) => {
      if (ev.pointerId !== start.id || start.done) return;
      if (ev.cancelable) ev.preventDefault();
      if (!start.started && pickable && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 5) {
        start.started = true;
        if (this.selected !== sq) this.select(sq);
        const pieceEl = this.cells[this.squareCell(sq)].querySelector('.piece');
        const size = this.cells[0].getBoundingClientRect().width;
        const g = document.createElement('div');
        g.className = 'drag-ghost'; g.style.width = g.style.height = size + 'px';
        g.innerHTML = pieceEl ? pieceEl.innerHTML : '';
        document.body.appendChild(g); start.ghost = g; start.size = size;
        if (pieceEl) pieceEl.classList.add('drag-origin');
      }
      if (start.started) {
        start.ghost.style.transform = `translate(${ev.clientX - start.size / 2}px, ${ev.clientY - start.size / 2}px)`;
        const over = this.squareAtPoint(ev.clientX, ev.clientY);
        this.cells.forEach((c) => c.classList.toggle('drag-over', +c.dataset.sq === over));
      }
    };
    const end = async (ev) => {
      if (ev.pointerId !== start.id || start.done) return;
      start.done = true;
      source.removeEventListener('pointermove', move);
      source.removeEventListener('pointerup', end);
      source.removeEventListener('pointercancel', end);
      try { if (captured && this.boardEl.hasPointerCapture(ev.pointerId)) this.boardEl.releasePointerCapture(ev.pointerId); } catch (_) {}
      this.cells.forEach((c) => c.classList.remove('drag-over'));
      if (start.ghost) start.ghost.remove();
      const origin = this.boardEl.querySelector('.drag-origin'); if (origin) origin.classList.remove('drag-origin');
      if (ev.type === 'pointercancel') { this.clearSelection(); return; }
      if (start.started) {
        const target = this.squareAtPoint(ev.clientX, ev.clientY);
        if (target != null && target !== sq && this.legalTargets.some((m) => m.to === target)) await this.tryTarget(target);
        else if (target !== sq) this.clearSelection();
      } else {
        const target = this.squareAtPoint(ev.clientX, ev.clientY);
        if (target != null) await this.activate(target);
      }
    };
    source.addEventListener('pointermove', move);
    source.addEventListener('pointerup', end);
    source.addEventListener('pointercancel', end);
  }

  focusCell(sq) {
    this.focusSq = sq; this.updateFocusable();
    const c = this.cells[this.squareCell(sq)]; if (c) c.focus();
  }

  keyDown(e) {
    const sq = this.sqOfEl(e.target); if (sq == null) return;
    const i = this.squareCell(sq); let row = Math.floor(i / 8), col = i % 8;
    switch (e.key) {
      case 'ArrowUp': row = Math.max(0, row - 1); break;
      case 'ArrowDown': row = Math.min(7, row + 1); break;
      case 'ArrowLeft': col = Math.max(0, col - 1); break;
      case 'ArrowRight': col = Math.min(7, col + 1); break;
      case 'Home': col = 0; break;
      case 'End': col = 7; break;
      case 'Enter': case ' ': e.preventDefault(); e.stopPropagation(); this.activate(sq); return;
      case 'Escape': if (this.selected != null) { e.stopPropagation(); this.clearSelection(); } return;
      default: return;
    }
    e.preventDefault(); e.stopPropagation();
    this.focusCell(this.cellSquare(row * 8 + col));
  }
}
