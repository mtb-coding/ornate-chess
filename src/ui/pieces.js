// Hand-drawn SVG piece sets. Each piece is drawn in a 100 x 100 box as a list
// of layers: 'body' (filled with the piece colour and outlined), 'trim'
// (filled with the accent colour), and 'line' (stroked inner detail).

const BASE = [
  ['body', 'M21 93 H79 Q83 93 83 89 V86 Q83 82 79 82 H21 Q17 82 17 86 V89 Q17 93 21 93 Z'],
  ['body', 'M27 82 H73 L69 75 H31 Z'],
];

const CLASSIC = {
  p: [
    ...BASE,
    ['body', 'M39 46 C39 58 35 67 31 75 H69 C65 67 61 58 61 46 Z'],
    ['body', 'M35 47 Q50 41 65 47 Q65 51 61 51 H39 Q35 51 35 47 Z'],
    ['body', 'M50 17 A12 12 0 1 1 49.99 17 Z'],
  ],
  r: [
    ...BASE,
    ['body', 'M34 75 L37 45 H63 L66 75 Z'],
    ['body', 'M30 45 H70 V39 H30 Z'],
    ['body', 'M30 39 V17 H39 V24 H45.5 V17 H54.5 V24 H61 V17 H70 V39 Z'],
    ['line', 'M37 56 H63 M36 66 H64'],
  ],
  n: [
    ...BASE,
    ['body', 'M30 75 C29 64 34 57 43 50 C38 51 33 54 28 58 C23 61 18 58 19 53 C21 46 30 39 34 32 C36 26 38 22 41 18 L44 24 C47 16 53 13 58 13 L58 18 C70 22 79 36 78 52 C77 62 73 69 71 75 Z'],
    ['line', 'M41 31 A2.5 2.5 0 1 0 41.01 31 M24 55 L26 53 M58 19 C66 26 70 36 70 48'],
  ],
  b: [
    ...BASE,
    ['body', 'M41 56 C41 64 35 70 31 75 H69 C65 70 59 64 59 56 Z'],
    ['body', 'M35 56 Q50 51 65 56 Q65 60 61 60 H39 Q35 60 35 56 Z'],
    ['body', 'M50 21 C37 30 32 41 38 52 H62 C68 41 63 30 50 21 Z'],
    ['body', 'M50 9 A5.5 5.5 0 1 1 49.99 9 Z'],
    ['line', 'M55 30 L46 43'],
  ],
  q: [
    ...BASE,
    ['body', 'M34 64 C35 69 33 72 30 75 H70 C67 72 65 69 66 64 Z'],
    ['body', 'M28 59 L21 30 L35 46 L37 24 L46 43 L50 20 L54 43 L63 24 L65 46 L79 30 L72 59 Z'],
    ['body', 'M27 60 Q50 54 73 60 Q73 65 69 65 H31 Q27 65 27 60 Z'],
    ['body', 'M21 21 A4.5 4.5 0 1 1 20.99 21 Z M37 15 A4.5 4.5 0 1 1 36.99 15 Z M50 11 A4.5 4.5 0 1 1 49.99 11 Z M63 15 A4.5 4.5 0 1 1 62.99 15 Z M79 21 A4.5 4.5 0 1 1 78.99 21 Z'],
  ],
  k: [
    ...BASE,
    ['body', 'M34 64 C35 69 33 72 30 75 H70 C67 72 65 69 66 64 Z'],
    ['body', 'M30 59 C20 48 23 33 37 35 C41 30 46 28 50 28 C54 28 59 30 63 35 C77 33 80 48 70 59 Z'],
    ['body', 'M27 60 Q50 54 73 60 Q73 65 69 65 H31 Q27 65 27 60 Z'],
    ['body', 'M46.5 5 H53.5 V11 H59 V17.5 H53.5 V28 H46.5 V17.5 H41 V11 H46.5 Z'],
    ['line', 'M50 33 V56 M33 44 Q50 38 67 44'],
  ],
};

const ORN_BASE = [
  ['body', 'M19 93 H81 Q84 93 84 90 V87 Q84 83 80 83 H20 Q16 83 16 87 V90 Q16 93 19 93 Z'],
  ['trim', 'M22 88 H78 V86.5 H22 Z'],
  ['body', 'M26 83 H74 Q72 78 68 76 H32 Q28 78 26 83 Z'],
];

const ORNAMENTAL = {
  p: [
    ...ORN_BASE,
    ['body', 'M40 49 C40 60 36 68 32 76 H68 C64 68 60 60 60 49 Z'],
    ['body', 'M34 49 Q50 42 66 49 Q66 53 62 53 H38 Q34 53 34 49 Z'],
    ['trim', 'M38 50.5 H62 V48 H38 Z'],
    ['body', 'M50 16 A12.5 12.5 0 1 1 49.99 16 Z'],
    ['line', 'M44 25 A7 7 0 0 1 53 21 M38 66 Q50 61 62 66'],
  ],
  r: [
    ...ORN_BASE,
    ['body', 'M34 76 L38 46 H62 L66 76 Z'],
    ['body', 'M29 46 H71 L68 39 H32 Z'],
    ['body', 'M30 39 L28 17 H38 L39 24 H45 L45 17 H55 L55 24 H61 L62 17 H72 L70 39 Z'],
    ['trim', 'M45 72 V60 Q50 52 55 60 V72 Z'],
    ['line', 'M32 33 H68 M38 52 H62'],
  ],
  n: [
    ...ORN_BASE,
    ['body', 'M30 76 C29 65 34 58 43 51 C38 52 33 55 28 59 C23 62 17 59 18 54 C20 47 29 40 33 33 C35 27 37 23 40 18 L44 24 C47 16 53 12 59 12 L58 18 C71 22 80 36 79 52 C78 63 74 70 72 76 Z'],
    ['trim', 'M59 19 C61 23 66 24 67 29 C69 33 73 35 72 41 C74 45 77 49 75 54 C76 59 73 64 72 70 C70 60 70 50 66 40 C63 32 60 26 56 21 Z'],
    ['line', 'M41 31 A2.5 2.5 0 1 0 41.01 31 M23 56 L26 53 M33 68 Q46 63 58 67'],
  ],
  b: [
    ...ORN_BASE,
    ['body', 'M41 58 C41 66 35 71 31 76 H69 C65 71 59 66 59 58 Z'],
    ['body', 'M34 57 Q50 51 66 57 Q66 61 62 61 H38 Q34 61 34 57 Z'],
    ['trim', 'M38 58.5 H62 V56 H38 Z'],
    ['body', 'M50 20 C36 29 31 42 38 53 H62 C69 42 64 29 50 20 Z'],
    ['body', 'M50 6 C54 6 56 9 56 12 C56 15 53 17 50 17 C47 17 44 15 44 12 C44 9 46 6 50 6 Z'],
    ['trim', 'M46 39 H54 V35 H52 V30 H48 V35 H46 Z'],
    ['line', 'M40 47 Q50 43 60 47'],
  ],
  q: [
    ...ORN_BASE,
    ['body', 'M34 65 C35 70 33 73 30 76 H70 C67 73 65 70 66 65 Z'],
    ['body', 'M28 60 L19 30 L33 44 L34 22 L44 40 L50 17 L56 40 L66 22 L67 44 L81 30 L72 60 Z'],
    ['body', 'M26 61 Q50 55 74 61 Q74 66 70 66 H30 Q26 66 26 61 Z'],
    ['trim', 'M31 62.5 H69 V60 H31 Z'],
    ['trim', 'M19 19 A4.5 4.5 0 1 1 18.99 19 Z M34 12 A4.5 4.5 0 1 1 33.99 12 Z M50 7 A5 5 0 1 1 49.99 7 Z M66 12 A4.5 4.5 0 1 1 65.99 12 Z M81 19 A4.5 4.5 0 1 1 80.99 19 Z'],
    ['line', 'M33 53 Q50 47 67 53'],
  ],
  k: [
    ...ORN_BASE,
    ['body', 'M34 65 C35 70 33 73 30 76 H70 C67 73 65 70 66 65 Z'],
    ['body', 'M30 60 C19 49 22 33 37 36 C41 31 46 29 50 29 C54 29 59 31 63 36 C78 33 81 49 70 60 Z'],
    ['body', 'M26 61 Q50 55 74 61 Q74 66 70 66 H30 Q26 66 26 61 Z'],
    ['trim', 'M31 62.5 H69 V60 H31 Z'],
    ['trim', 'M47 4 H53 V10 C55 8 59 8 60 11 C61 14 58 16 53 16 V29 H47 V16 C42 16 39 14 40 11 C41 8 45 8 47 10 Z'],
    ['trim', 'M50 41 L54 46 L50 51 L46 46 Z'],
    ['line', 'M33 45 Q41 41 46 45 M54 45 Q59 41 67 45'],
  ],
};

export const PIECE_SETS = {
  classic: { name: 'Classic Staunton', shapes: CLASSIC },
  ornamental: { name: 'Ornamental', shapes: ORNAMENTAL },
};

const STYLE = {
  classic: {
    w: { fill: 'url(#pc-ivory)', stroke: '#24180b', trim: '#24180b', line: '#24180b' },
    b: { fill: 'url(#pc-ebony)', stroke: '#050403', trim: '#e9dcc0', line: '#e9dcc0' },
  },
  ornamental: {
    w: { fill: 'url(#pc-ivory)', stroke: '#2e1c0a', trim: 'url(#pc-gold)', line: '#6f5216' },
    b: { fill: 'url(#pc-ebony)', stroke: '#050403', trim: 'url(#pc-gold)', line: '#d8b65e' },
  },
};

export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const COLOR_NAMES = { w: 'white', b: 'black' };

export function pieceSvg(set, color, type) {
  const s = PIECE_SETS[set] ? set : 'classic';
  const st = STYLE[s][color];
  const layers = PIECE_SETS[s].shapes[type].map(([role, d]) => {
    if (role === 'body') return `<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="3" stroke-linejoin="round"/>`;
    if (role === 'trim') return `<path d="${d}" fill="${st.trim}" stroke="${st.stroke}" stroke-width="1.2" stroke-linejoin="round"/>`;
    return `<path d="${d}" fill="none" stroke="${st.line}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg class="piece-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${layers}</svg>`;
}

// Shared gradient definitions, inserted once into the document.
export const PIECE_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<linearGradient id="pc-ivory" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset=".55" stop-color="#f1e6cc"/><stop offset="1" stop-color="#d9c7a0"/></linearGradient>
<linearGradient id="pc-ebony" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a3c30"/><stop offset=".5" stop-color="#231a13"/><stop offset="1" stop-color="#0c0806"/></linearGradient>
<linearGradient id="pc-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6e39a"/><stop offset=".5" stop-color="#c9a13e"/><stop offset="1" stop-color="#8a6618"/></linearGradient>
</defs></svg>`;
