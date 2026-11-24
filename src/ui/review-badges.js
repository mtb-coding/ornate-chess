// Classification badges for the review board and move list.
// The symbols follow the conventional chess.com Game Review set (documented
// in NOTES-review.md). The drawings are original, in this application's
// gold-and-ink style, and are not copied from chess.com assets.

export const BADGE_SYMBOLS = Object.freeze({
  brilliant: '!!',
  great: '!',
  best: '★',
  excellent: '👍',
  good: '✓',
  book: '📖',
  inaccuracy: '?!',
  mistake: '?',
  miss: '✕',
  blunder: '??',
  forced: '→',
});

/** Fill and ink for the circular badge, chosen to sit on the board's palette. */
export const BADGE_COLORS = Object.freeze({
  brilliant: { fill: '#5c2d6e', ink: '#f3e6c8' },
  great: { fill: '#1f6b4a', ink: '#f3e6c8' },
  best: { fill: '#2f6a3a', ink: '#f3e6c8' },
  excellent: { fill: '#3d6e4a', ink: '#f3e6c8' },
  good: { fill: '#4a5c38', ink: '#f3e6c8' },
  book: { fill: '#6a5428', ink: '#f3e6c8' },
  forced: { fill: '#4a4a4a', ink: '#f3e6c8' },
  inaccuracy: { fill: '#b8892d', ink: '#1b140e' },
  mistake: { fill: '#c26a2a', ink: '#1b140e' },
  miss: { fill: '#b54a3a', ink: '#f3e6c8' },
  blunder: { fill: '#8e1e1e', ink: '#f3e6c8' },
});

function iconPath(kind, ink) {
  const s = ink;
  switch (kind) {
    case 'brilliant':
      return `<text x="16" y="21" text-anchor="middle" fill="${s}" font-size="13" font-family="Georgia, serif" font-weight="700">!!</text>`;
    case 'great':
      return `<text x="16" y="22" text-anchor="middle" fill="${s}" font-size="18" font-family="Georgia, serif" font-weight="700">!</text>`;
    case 'best':
      return `<path fill="${s}" d="M16 6.2 l2.4 7.2 h7.6 l-6.1 4.5 2.4 7.3L16 21.1l-6.3 4.1 2.4-7.3-6.1-4.5h7.6z"/>`;
    case 'excellent':
      return `<path fill="${s}" d="M10 14c0-3 2-5 5-5s5 2 5 5v2h3v8H10V14zm5-7c1.4 0 2.5 1 2.5 2.3S16.4 11.5 15 11.5 12.5 10.5 12.5 9.3 13.6 7 15 7z"/>`;
    case 'good':
      return `<path fill="none" stroke="${s}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M8 16.5 l5 5 11-12"/>`;
    case 'book':
      return `<path fill="${s}" d="M8 7.5h7.5c2 0 3.5 1.2 3.5 3v14c-1.4-1-2.8-1.5-3.5-1.5H8V7.5zm8.5 0H24v16h-7.5c-.7 0-2.1.5-3.5 1.5v-14c0-1.8 1.5-3 3.5-3z"/>`;
    case 'inaccuracy':
      return `<text x="16" y="21" text-anchor="middle" fill="${s}" font-size="12" font-family="Georgia, serif" font-weight="700">?!</text>`;
    case 'mistake':
      return `<text x="16" y="22" text-anchor="middle" fill="${s}" font-size="18" font-family="Georgia, serif" font-weight="700">?</text>`;
    case 'miss':
      return `<path fill="none" stroke="${s}" stroke-width="3.2" stroke-linecap="round" d="M9 9 l14 14 M23 9 L9 23"/>`;
    case 'blunder':
      return `<text x="16" y="21" text-anchor="middle" fill="${s}" font-size="13" font-family="Georgia, serif" font-weight="700">??</text>`;
    case 'forced':
      return `<path fill="none" stroke="${s}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M6 16 h16 m0 0 l-6-6 m6 6 l-6 6"/>`;
    default:
      return '';
  }
}

/** SVG markup for a circular classification badge (32×32 viewBox). */
export function badgeSvg(kind, { className = 'review-badge-svg' } = {}) {
  const k = BADGE_COLORS[kind] ? kind : 'good';
  const { fill, ink } = BADGE_COLORS[k];
  return `<svg class="${className}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <circle cx="16" cy="16" r="15" fill="${fill}" stroke="#c8a44a" stroke-width="1.4"/>
    ${iconPath(k, ink)}
  </svg>`;
}

/** A compact chip: badge + label, for the move list and the current-move row. */
export function badgeChipHtml(kind, label, { evalText = '', extraClass = '' } = {}) {
  const k = BADGE_COLORS[kind] ? kind : 'good';
  const ev = evalText ? `<span class="review-chip-eval">${evalText}</span>` : '';
  return `<span class="review-chip j-${k} ${extraClass}" data-judgment="${k}">${badgeSvg(k, { className: 'review-badge-svg chip' })}<span class="review-chip-name">${label}</span>${ev}</span>`;
}
