// Board annotations drawn with the right mouse button, as on Chess.com:
// right-click a square to toggle a highlight, right-drag to toggle an arrow.
// This module holds the state, the colour rules and the arrow geometry. It
// does not touch the DOM, so Node tests can import it.

/** Colours chosen to sit on the ebony, ivory and gold palette. */
export const ANNOTATION_COLORS = {
  gold: { name: 'gold', label: 'Gold', fill: 'rgb(226, 178, 64)', square: 'rgba(222, 170, 52, .58)' },
  green: { name: 'green', label: 'Green', fill: 'rgb(120, 170, 92)', square: 'rgba(104, 160, 80, .6)' },
  red: { name: 'red', label: 'Red', fill: 'rgb(196, 84, 66)', square: 'rgba(190, 72, 56, .6)' },
  blue: { name: 'blue', label: 'Blue', fill: 'rgb(84, 140, 190)', square: 'rgba(76, 132, 186, .6)' },
};

export const ANNOTATION_HELP = 'With a mouse, right-click a square to highlight it or drag with the right button from one square to another to draw an arrow, hold Shift for green, Ctrl for red, or Alt for blue instead of the default gold, repeat the same mark to remove it, and left-click the board to clear every mark.';

/** Plain is gold, Shift is green, Ctrl (or Cmd) is red, and Alt or Ctrl+Shift is blue. */
export function colorForModifiers(e = {}) {
  const ctrl = !!(e.ctrlKey || e.metaKey), shift = !!e.shiftKey, alt = !!e.altKey;
  if (alt || (ctrl && shift)) return 'blue';
  if (ctrl) return 'red';
  if (shift) return 'green';
  return 'gold';
}

export class Annotations {
  constructor() { this.highlights = new Map(); this.arrows = []; }
  get isEmpty() { return this.highlights.size === 0 && this.arrows.length === 0; }
  clear() { const had = !this.isEmpty; this.highlights.clear(); this.arrows = []; return had; }

  /** Same colour removes the highlight; another colour replaces it. Returns the new state of the square. */
  toggleHighlight(sq, color = 'gold') {
    if (this.highlights.get(sq) === color) { this.highlights.delete(sq); return null; }
    this.highlights.set(sq, color);
    return color;
  }

  /** Same arrow in the same colour is removed; in another colour it is recoloured. */
  toggleArrow(from, to, color = 'gold') {
    if (from === to) return this.toggleHighlight(from, color);
    const i = this.arrows.findIndex((a) => a.from === from && a.to === to);
    if (i >= 0) {
      if (this.arrows[i].color === color) { this.arrows.splice(i, 1); return null; }
      this.arrows[i] = { from, to, color };
      return color;
    }
    this.arrows.push({ from, to, color });
    return color;
  }

  snapshot() { return { highlights: [...this.highlights].map(([sq, color]) => ({ sq, color })), arrows: this.arrows.map((a) => ({ ...a })) }; }
}

// ---------------------------------------------------------------- geometry
// The overlay uses a 0..800 view box, 100 units per square.

/** Centre of a square in overlay units for the given orientation. */
export function squareCenter(sq, orientation = 'w') {
  const f = sq & 7, r = sq >> 3;
  const col = orientation === 'w' ? f : 7 - f;
  const row = orientation === 'w' ? 7 - r : r;
  return [col * 100 + 50, row * 100 + 50];
}

export function isKnightJump(from, to) {
  const df = Math.abs((to & 7) - (from & 7)), dr = Math.abs((to >> 3) - (from >> 3));
  return (df === 1 && dr === 2) || (df === 2 && dr === 1);
}

/**
 * Points of the arrow centre line: [start, (corner,) tip]. Knight jumps are
 * L-shaped and travel the long leg first, as on Chess.com.
 */
export function arrowPoints(from, to, orientation = 'w') {
  const a = squareCenter(from, orientation), b = squareCenter(to, orientation);
  if (isKnightJump(from, to)) {
    const corner = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? [b[0], a[1]] : [a[0], b[1]];
    return [a, corner, b];
  }
  return [a, b];
}

const SHAFT = 9;     // half width of the shaft
const HEAD_W = 23;   // half width of the head
const HEAD_L = 34;   // length of the head
const START = 18;    // gap between the square centre and the tail
const TIP_GAP = 8;   // gap between the square centre and the tip

const r1 = (n) => Math.round(n * 10) / 10;

/** One closed outline (shaft and head together) so translucency never doubles. */
export function arrowOutline(from, to, orientation = 'w') {
  const pts = arrowPoints(from, to, orientation).map((p) => [...p]);
  const dir = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  const n = pts.length;
  // Shorten the tail and the tip.
  const d0 = dir(pts[0], pts[1]);
  pts[0] = [pts[0][0] + d0[0] * START, pts[0][1] + d0[1] * START];
  const dl = dir(pts[n - 2], pts[n - 1]);
  const tip = [pts[n - 1][0] - dl[0] * TIP_GAP, pts[n - 1][1] - dl[1] * TIP_GAP];
  const base = [tip[0] - dl[0] * HEAD_L, tip[1] - dl[1] * HEAD_L];
  const norm = (d) => [-d[1], d[0]];
  const nl = norm(dl);
  const left = [], right = [];
  const n0 = norm(d0);
  left.push([pts[0][0] + n0[0] * SHAFT, pts[0][1] + n0[1] * SHAFT]);
  right.push([pts[0][0] - n0[0] * SHAFT, pts[0][1] - n0[1] * SHAFT]);
  if (n === 3) {
    // Right-angle corner: the offset lines meet at corner + h*n0 + h*nl.
    const c = pts[1];
    left.push([c[0] + (n0[0] + nl[0]) * SHAFT, c[1] + (n0[1] + nl[1]) * SHAFT]);
    right.push([c[0] - (n0[0] + nl[0]) * SHAFT, c[1] - (n0[1] + nl[1]) * SHAFT]);
  }
  left.push([base[0] + nl[0] * SHAFT, base[1] + nl[1] * SHAFT], [base[0] + nl[0] * HEAD_W, base[1] + nl[1] * HEAD_W]);
  right.push([base[0] - nl[0] * SHAFT, base[1] - nl[1] * SHAFT], [base[0] - nl[0] * HEAD_W, base[1] - nl[1] * HEAD_W]);
  const ring = [...left, tip, ...right.reverse()];
  return { points: ring.map((p) => [r1(p[0]), r1(p[1])]), tip: [r1(tip[0]), r1(tip[1])], knight: n === 3 };
}

export function arrowPathD(from, to, orientation = 'w') {
  const { points } = arrowOutline(from, to, orientation);
  return 'M' + points.map((p) => `${p[0]} ${p[1]}`).join(' L') + ' Z';
}

/** Inset of the marker tip from the destination square centre, in overlay units. */
export const ENGINE_ARROW_TIP = 22;

/**
 * Engine, hint and review arrows are stroked paths with a marker at the tip.
 * A knight move is drawn as an L, long leg first, matching arrowPoints.
 * `opts.piece` is the moving piece type (`n` for a knight). When it is
 * omitted, a 1-by-2 jump is treated as a knight move.
 */
export function engineArrowGeometry(from, to, orientation = 'w', opts = {}) {
  const piece = opts.piece ? String(opts.piece).toLowerCase() : null;
  const knight = piece === 'n' || (piece == null && isKnightJump(from, to));
  const raw = (knight && isKnightJump(from, to))
    ? arrowPoints(from, to, orientation)
    : [squareCenter(from, orientation), squareCenter(to, orientation)];
  const pts = raw.map((p) => [p[0], p[1]]);
  const n = pts.length;
  const dx = pts[n - 1][0] - pts[n - 2][0], dy = pts[n - 1][1] - pts[n - 2][1];
  const len = Math.hypot(dx, dy) || 1;
  pts[n - 1][0] -= (dx / len) * ENGINE_ARROW_TIP;
  pts[n - 1][1] -= (dy / len) * ENGINE_ARROW_TIP;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  return { d, points: pts, knight: n === 3 };
}

