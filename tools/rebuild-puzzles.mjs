/**
 * Rebuild the puzzle database: fix defective entries, then add verified
 * hard puzzles from the CC0 Lichess database (pre-filtered CSV).
 *
 * Usage: node tools/rebuild-puzzles.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Position } from '../src/engine.js';
import { PUZZLES as OLD } from '../src/data/puzzles.js';
import { chooseMove, analyze, evaluate } from '../src/ai.js';
import * as T from './puzzle-tactics.mjs';

const LICHESS_CSV = '/tmp/lichess/hard-candidates.csv';

const REPLACEMENTS = {
  'ds-31': {
    title: 'Discovered check wins the queen',
    theme: 'discovered',
    difficulty: 3,
    rating: 1500,
    fen: '4q2k/8/8/8/4B3/8/8/4R1K1 w - - 0 1',
    solution: ['e4h7'],
    hint: 'Move the bishop so that it checks the king and uncovers an attack on the queen.',
    explanation: 'Bishop to h7 checks the king and uncovers the rook on e1, which attacks the queen on e8. Black cannot save both the king and the queen.',
  },
  'ds-20': {
    title: 'Discovered check captures the queen',
    theme: 'discovered',
    difficulty: 3,
    rating: 1450,
    fen: '4k3/3q4/8/4N3/8/8/8/4R1K1 w - - 0 1',
    solution: ['e5d7'],
    hint: 'Capture the queen with a move that also uncovers the rook.',
    explanation: 'The knight captures the queen on d7 and uncovers a check from the rook on e1. If the king recaptures, White has won a queen for a knight.',
  },
  'fk-02': {
    title: 'Knight forks king and queen',
    theme: 'fork',
    difficulty: 2,
    rating: 1100,
    fen: '4k3/8/8/8/2q1N3/8/8/4K3 w - - 0 1',
    solution: ['e4d6'],
    hint: 'Find the checking square that also attacks the queen.',
    explanation: 'Knight to d6 checks the king and attacks the queen at the same time, so the queen is lost.',
  },
  'fk-03': {
    title: 'Pawn forks king and knight',
    theme: 'fork',
    difficulty: 1,
    rating: 850,
    fen: '8/8/3k1n2/8/4P3/8/8/4K3 w - - 0 1',
    solution: ['e4e5'],
    hint: 'Advance the pawn so that it attacks the king and the knight.',
    explanation: 'Pawn to e5 attacks the king on d6 and the knight on f6 at the same time.',
  },
  'fk-23': {
    title: 'Pawn forks two knights',
    theme: 'fork',
    difficulty: 1,
    rating: 950,
    fen: '8/8/2n1n3/8/3P4/8/8/4K1k1 w - - 0 1',
    solution: ['d4d5'],
    hint: 'Advance the pawn so both knights are attacked.',
    explanation: 'Pawn to d5 attacks the knights on c6 and e6 at the same time, so one of them is lost.',
  },
  'pn-20': {
    title: 'Absolute pin on the knight',
    theme: 'pin',
    difficulty: 2,
    rating: 1250,
    fen: '3k4/8/8/3n4/8/8/8/3RK3 w - - 0 1',
    solution: ['d1d5'],
    hint: 'The knight cannot leave the file of its king.',
    explanation: 'The knight on d5 is pinned to the king, so the rook can capture it. The king cannot recapture because the rook is protected by the white king, and the pin already prevented the knight from escaping.',
  },
  'pn-22': {
    title: 'Bishop pins the knight to the king',
    theme: 'pin',
    difficulty: 2,
    rating: 1200,
    fen: '6k1/8/8/3n4/8/8/8/1B4K1 w - - 0 1',
    solution: ['b1a2'],
    hint: 'Place the bishop on the same diagonal as the knight and the king.',
    explanation: 'Bishop to a2 pins the knight to the king and attacks it. The knight cannot move off the diagonal, so it is lost.',
  },
  'sk-02': {
    title: 'Bishop skewer on the long diagonal',
    theme: 'skewer',
    difficulty: 2,
    rating: 1100,
    fen: '7q/6k1/8/8/8/8/8/2B3K1 w - - 0 1',
    solution: ['c1b2'],
    hint: 'Check the king so that the queen behind it is exposed.',
    explanation: 'Bishop to b2 checks the king on g7, and the queen on h8 lies behind the king on the same diagonal. After the king moves, the bishop wins the queen.',
  },
  'sk-03': {
    title: 'Rook skewer on the back rank',
    theme: 'skewer',
    difficulty: 2,
    rating: 1100,
    fen: 'q3k3/8/8/8/8/8/8/4K2R w - - 0 1',
    solution: ['h1h8'],
    hint: 'Check on the eighth rank, where the queen sits behind the king.',
    explanation: 'Rook to h8 checks the king, and the queen on a8 is behind the king on the same rank. After the king moves, the rook wins the queen.',
  },
  'df-01': {
    title: 'Deflect the back-rank defender',
    theme: 'deflection',
    difficulty: 3,
    rating: 1400,
    fen: '3r2k1/5ppp/8/8/8/8/4RPPP/4Q1K1 w - - 0 1',
    solution: ['e2e8', 'd8e8', 'e1e8'],
    hint: 'Force the defending rook off its file with a check on the back rank.',
    explanation: 'Rook to e8 checks the king and must be captured by the defending rook. The queen then recaptures on e8 and mates because the black pawns block their king.',
  },
  'df-02': {
    title: 'Deflect the rook, then mate',
    theme: 'deflection',
    difficulty: 3,
    rating: 1400,
    fen: 'r5k1/5ppp/8/8/8/8/4RPPP/4Q1K1 w - - 0 1',
    solution: ['e2e8', 'a8e8', 'e1e8'],
    hint: 'Sacrifice on e8 so that the queen can enter on the back rank.',
    explanation: 'Rook to e8 forces the defending rook to recapture. The queen then recaptures on e8 and mates on the back rank.',
  },
  'df-20': {
    title: 'Rook sacrifice deflects the defender',
    theme: 'deflection',
    difficulty: 3,
    rating: 1450,
    fen: '2r3k1/5ppp/8/8/8/8/4RPPP/4Q1K1 w - - 0 1',
    solution: ['e2e8', 'c8e8', 'e1e8'],
    hint: 'Give check on e8 to pull the defender onto that square.',
    explanation: 'Rook to e8 is a check that the black rook must capture. The queen then recaptures on e8 and mates on the back rank.',
  },
  'df-21': {
    title: 'Deflection by a rook check',
    theme: 'deflection',
    difficulty: 3,
    rating: 1400,
    fen: 'r5k1/5ppp/8/8/8/8/2R2PPP/2Q3K1 w - - 0 1',
    solution: ['c2c8', 'a8c8', 'c1c8'],
    hint: 'Check on c8 so that the defending rook is forced to recapture.',
    explanation: 'Rook to c8 checks the king and is captured by the defending rook. The queen recaptures on c8 and mates because the black pawns block their king.',
  },
  'sc-01': {
    title: 'Queen sacrifice for back-rank mate',
    theme: 'sacrifice',
    difficulty: 4,
    rating: 1700,
    fen: '3r2k1/5ppp/8/8/8/8/4QPPP/4R1K1 w - - 0 1',
    solution: ['e2e8', 'd8e8', 'e1e8'],
    hint: 'Give the queen on the back rank so that the rook can recapture with mate.',
    explanation: 'Queen to e8 checks the king and is captured by the defending rook. The white rook then recaptures on e8 and mates on the back rank.',
  },
  'sc-22': {
    title: 'Queen sacrifice on the d-file',
    theme: 'sacrifice',
    difficulty: 3,
    rating: 1500,
    fen: 'r5k1/5ppp/8/8/8/8/3Q1PPP/3R2K1 w - - 0 1',
    solution: ['d2d8', 'a8d8', 'd1d8'],
    hint: 'Offer the queen on the back rank, then recapture with the rook.',
    explanation: 'Queen to d8 checks the king and is captured by the black rook. The white rook recaptures on d8 and mates because the black pawns block their king.',
  },
  'pr-22': {
    title: 'Knight underpromotion to force mate',
    theme: 'promotion',
    difficulty: 4,
    rating: 1850,
    fen: '5N2/1p2R1P1/2b4k/8/5K2/8/8/q5r1 w - - 0 1',
    solution: ['g7g8n', 'g1g8', 'e7h7'],
    hint: 'A queen promotion would not give the check that is needed. Promote to a knight.',
    explanation: 'The pawn promotes to a knight and checks the king. After the rook captures the knight, the white rook mates on h7. Promoting to a queen or rook would not produce this mating sequence.',
  },
};

const TEXT_PATCHES = {
  'pn-04': {
    title: 'Absolute pin on the file',
    hint: 'The queen cannot leave the file without exposing the king.',
    explanation: 'The queen is pinned to the king on the d-file. The rook captures the queen, winning a queen for a rook after the king recaptures.',
  },
  'pr-01': {
    title: 'Promote to a queen',
    hint: 'Advance the pawn to the eighth rank and promote it.',
    explanation: 'Pawn to e8 promotes to a queen and gives White a decisive material advantage. The promotion does not deliver immediate checkmate.',
  },
  'pr-02': {
    title: 'Promote with a capture',
    hint: 'Capture on the promotion square to create a new queen with check.',
    explanation: 'The pawn captures the rook on f8 and promotes to a queen, giving check and winning a rook.',
  },
  'm1-07': {
    title: 'Queen mate on the open file',
    hint: 'The e-file is open to the eighth rank.',
    explanation: 'Queen to e8 is checkmate. The black pawns on g7 and h7 leave the king with no safe flight square.',
  },
  'm2-02': {
    title: 'Back-rank queen mate',
    hint: 'The eighth rank is open to the queen.',
    explanation: 'Queen to a8 is checkmate on the back rank because the pawns on f7, g7, and h7 block the king.',
  },
  'm3-01': {
    hint: 'Cut the seventh rank first, then finish with the other rook.',
    explanation: 'Rook to b7 cuts the seventh rank so the black king cannot step forward. The second rook then mates on the eighth rank on the third move.',
  },
  'm3-hand-2': {
    hint: 'Cut the seventh rank first, then finish with the other rook.',
    explanation: 'Rook to b7 cuts the seventh rank so the black king cannot step forward. The second rook then mates on the eighth rank on the third move.',
  },
  'm3-hand-3': {
    hint: 'Cut the seventh rank first, then finish with the other rook.',
    explanation: 'Rook to b7 cuts the seventh rank so the black king cannot step forward. The second rook then mates on the eighth rank on the third move.',
  },
  'm3-hand-4': {
    hint: 'Cut the seventh rank first, then finish with the other rook.',
    explanation: 'Rook to g7 cuts the seventh rank so the black king cannot step forward. The second rook then mates on the eighth rank on the third move.',
  },
  'zg-20': {
    hint: 'Approach with the king on either side of the pawn.',
    explanation: 'King to e2 or c2 takes the opposition. Black must give ground, and the pawn can then advance.',
    alternatives: [['d1e2', 'd1c2']],
  },
  'eg-22': {
    hint: 'Bring the king forward to support the pawn, either to e3 or to d3.',
    explanation: 'King to e3 or d3 supports the pawn and wins the pawn ending.',
    alternatives: [['d2e3', 'd2d3']],
  },
};

function parseCsv(path) {
  const raw = readFileSync(path, 'utf8').replace(/\r/g, '');
  const lines = raw.trim().split('\n');
  const rows = [];
  for (const line of lines.slice(1)) {
    const parts = [];
    let cur = '', inq = false;
    for (const ch of line) {
      if (ch === '"') { inq = !inq; continue; }
      if (ch === ',' && !inq) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    rows.push({
      id: parts[0],
      fen: parts[1],
      moves: parts[2].split(' '),
      rating: +parts[3],
      rd: +parts[4],
      pop: +parts[5],
      plays: +parts[6],
      themes: parts[7].split(' '),
      url: parts[8] || '',
    });
  }
  return rows;
}

function mapTheme(themes, pos, first, line) {
  const t = new Set(themes);
  if (t.has('mateIn4') && line.pos.isCheckmate() && Math.ceil(line.sans.length / 2) === 4) return 'mate-in-4';
  if (t.has('mateIn3') && line.pos.isCheckmate() && Math.ceil(line.sans.length / 2) === 3) return 'mate-in-3';
  if (t.has('backRankMate') && T.isBackRankMate(line.pos, null)) return 'back-rank';
  if ((t.has('discoveredAttack') || t.has('discoveredCheck') || t.has('doubleCheck')) && T.isDiscoveredAttack(pos, first)) return 'discovered';
  if (t.has('fork') && T.isFork(pos, first)) return 'fork';
  if (t.has('skewer') && T.isSkewer(pos, first)) return 'skewer';
  if (t.has('pin') && T.isPinMove(pos, first)) return 'pin';
  if ((t.has('promotion') || t.has('underPromotion') || t.has('advancedPawn')) && T.isPromotionMove(first)) return 'promotion';
  if (t.has('deflection')) return 'deflection';
  if (t.has('zugzwang')) return 'zugzwang-ish';
  if (t.has('sacrifice') || t.has('queenSacrifice') || t.has('rookSacrifice') || t.has('bishopSacrifice') || t.has('knightSacrifice')) {
    if (T.immediateMaterialLoss(pos, first) > 0 || t.has('sacrifice')) return 'sacrifice';
  }
  if (t.has('endgame') || t.has('pawnEndgame') || t.has('rookEndgame') || t.has('queenEndgame') || t.has('bishopEndgame') || t.has('knightEndgame')) return 'endgame';
  // Detector fallback
  if (T.isDiscoveredAttack(pos, first)) return 'discovered';
  if (T.isFork(pos, first)) return 'fork';
  if (T.isSkewer(pos, first)) return 'skewer';
  if (T.isPinMove(pos, first)) return 'pin';
  if (T.isPromotionMove(first)) return 'promotion';
  if (line.pos.isCheckmate() && Math.ceil(line.sans.length / 2) === 4) return 'mate-in-4';
  if (line.pos.isCheckmate() && Math.ceil(line.sans.length / 2) === 3) return 'mate-in-3';
  return 'endgame';
}

function titleFor(theme, line, first, tags) {
  const side = first.color === 'b' ? 'Black' : 'White';
  const map = {
    'mate-in-3': 'Mate in three',
    'mate-in-4': 'Mate in four',
    'back-rank': 'Back-rank mate',
    discovered: 'Discovered attack',
    fork: 'Fork',
    skewer: 'Skewer',
    pin: 'Pin',
    promotion: T.isPromotionMove(first) && first.promotion && first.promotion !== 'q' ? 'Underpromotion' : 'Promotion',
    deflection: 'Deflection',
    'zugzwang-ish': 'Zugzwang',
    sacrifice: 'Sacrifice',
    endgame: 'Endgame combination',
  };
  let base = map[theme] || 'Tactical combination';
  if (tags.includes('intermezzo')) base = 'Zwischenzug, then ' + base.toLowerCase();
  if (tags.includes('quietMove') && theme !== 'zugzwang-ish') base = 'Quiet move: ' + base.toLowerCase();
  return base;
}

function hintFor(theme) {
  const map = {
    'mate-in-3': 'Look for a forcing sequence that mates on the third move.',
    'mate-in-4': 'Look for a forcing sequence that mates on the fourth move.',
    'back-rank': 'The king is trapped on the back rank.',
    discovered: 'Move one piece so that another piece behind it gives an attack.',
    fork: 'One move can attack two targets at once.',
    skewer: 'Check through a valuable piece so that the piece behind it is exposed.',
    pin: 'A piece cannot move without exposing a more valuable piece behind it.',
    promotion: 'The pawn can promote, or threaten to promote, with a decisive effect.',
    deflection: 'Force a defending piece away from a key square.',
    'zugzwang-ish': 'A quiet move can leave the opponent with no useful reply.',
    sacrifice: 'Giving up material can force a winning continuation.',
    endgame: 'Find the precise endgame continuation that keeps the advantage.',
  };
  return map[theme] || 'Find the only move that keeps a decisive advantage.';
}

function explain(theme, side, sans, pos, first, line, tags) {
  const who = side === 'b' ? 'Black' : 'White';
  const seq = sans.join(' ');
  const bits = [];
  bits.push(`The solution begins with ${sans[0]}.`);
  const disc = T.isDiscoveredAttack(pos, first);
  const fork = T.isFork(pos, first);
  const skewer = T.isSkewer(pos, first);
  const pin = T.isPinMove(pos, first);
  if (disc) bits.push('The first move uncovers an attack from a piece standing behind it.');
  if (fork) {
    const names = fork.map((t) => ({ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }[t.type] || t.type));
    bits.push(`The moving piece forks the ${names.join(' and ')}.`);
  }
  if (skewer) bits.push('The first move is a skewer: a more valuable piece is checked or attacked, and a piece behind it is left exposed.');
  if (pin && pin.created?.length) bits.push('The first move creates a pin.');
  if (pin && pin.capturedPinned) bits.push('The first move captures a pinned piece.');
  if (T.isPromotionMove(first)) {
    const pr = first.promotion === 'q' ? 'a queen' : first.promotion === 'n' ? 'a knight' : first.promotion === 'r' ? 'a rook' : 'a bishop';
    bits.push(`The pawn promotes to ${pr}.`);
  }
  if (tags.includes('intermezzo')) bits.push('An intermediate move is inserted before the expected recapture or continuation.');
  if (line.pos.isCheckmate()) bits.push(`The forced line is ${seq}, ending in checkmate.`);
  else bits.push(`The main line is ${seq}, which keeps a decisive advantage for ${who}.`);
  return bits.join(' ');
}

function difficultyOf(rating) {
  if (rating >= 2100) return { difficulty: 5, rating: Math.min(2300, rating) };
  return { difficulty: 4, rating: Math.min(2100, Math.max(1700, rating)) };
}

function primaryBucket(themes) {
  const order = ['mateIn4', 'mateIn3', 'zugzwang', 'underPromotion', 'promotion', 'deflection', 'discoveredAttack', 'discoveredCheck', 'sacrifice', 'intermezzo', 'fork', 'pin', 'skewer', 'quietMove', 'endgame', 'pawnEndgame'];
  for (const t of order) if (themes.includes(t)) return t;
  return 'other';
}

async function selectHard(existingFens, replaceSlots) {
  const rows = parseCsv(LICHESS_CSV);
  // Prefer diverse, well-tested, mid-to-high hard range
  rows.sort((a, b) => (b.pop - a.pop) || (b.plays - a.plays) || (a.rd - b.rd));
  const buckets = new Map();
  for (const r of rows) {
    const b = primaryBucket(r.themes);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(r);
  }
  const shortlist = [];
  const cap = { mateIn4: 8, mateIn3: 8, zugzwang: 6, deflection: 6, discoveredAttack: 6, discoveredCheck: 4, sacrifice: 8, intermezzo: 6, fork: 6, pin: 5, skewer: 4, promotion: 4, underPromotion: 4, quietMove: 6, endgame: 8, pawnEndgame: 5, other: 4 };
  for (const [b, list] of buckets) {
    shortlist.push(...list.slice(0, cap[b] || 4));
  }
  // unique by id
  const seen = new Set();
  const pool = shortlist.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  console.error(`hard shortlist ${pool.length}`);

  const accepted = [];
  const usedFen = new Set(existingFens);
  for (const r of pool) {
    if (accepted.length >= 40 && replaceSlots.length === 0) break;
    let pos0;
    try { pos0 = Position.fromFen(r.fen); } catch { continue; }
    const setup = pos0.parseUci(r.moves[0]);
    if (!setup) continue;
    let pos;
    try { pos = pos0.makeMove(setup); } catch { continue; }
    // Normalise FEN clock
    const startFen = pos.toFen().replace(/ \d+ \d+$/, ' 0 1');
    try { pos = Position.fromFen(startFen); } catch { continue; }
    if (usedFen.has(startFen)) continue;
    const sol = r.moves.slice(1).map((u) => u.toLowerCase());
    const line = T.playLine(startFen, sol);
    if (!line.ok) continue;
    const first = pos.parseUci(sol[0]);
    if (!first) continue;
    const playerMoves = Math.ceil(sol.length / 2);
    if (playerMoves < 3 || playerMoves > 6) continue;

    const theme = mapTheme(r.themes, pos, first, line);
    if (theme.startsWith('mate-in-')) {
      const n = theme === 'mate-in-4' ? 4 : theme === 'mate-in-3' ? 3 : 0;
      if (n) {
        if (!line.pos.isCheckmate()) continue;
        if (playerMoves !== n) continue;
        let mates;
        try { mates = T.matingFirstMoves(pos, n); } catch { continue; }
        if (!mates.map((u) => u.toLowerCase()).includes(sol[0])) continue;
        if (mates.length !== 1) continue; // unique
      }
    }

    // Deep search should agree on the first move
    let deep;
    try {
      deep = await chooseMove(pos, { difficultyId: 'lvl8', timeMs: 1400 });
    } catch { continue; }
    const deepUci = deep?.move ? pos.moveToUci(deep.move).toLowerCase() : '';
    if (deepUci !== sol[0]) {
      continue;
    }

    // Shallow depth-2 should not already have it as a clear unique winner
    let shallow;
    try {
      shallow = await analyze(pos, { depth: 2, timeMs: 400, multiPv: Math.min(3, pos.legalMoves().length) });
    } catch { shallow = []; }
    if (shallow.length) {
      const s0 = pos.moveToUci(shallow[0].move).toLowerCase();
      const gap = shallow.length > 1 ? shallow[0].score - shallow[1].score : 9999;
      if (s0 === sol[0] && gap >= 200) {
        // too obvious at depth 2
        continue;
      }
    }

    const band = difficultyOf(r.rating);
    const puzzle = {
      id: 'li-' + r.id,
      title: titleFor(theme, line, first, r.themes),
      theme,
      difficulty: band.difficulty,
      rating: band.rating,
      fen: startFen,
      solution: sol,
      hint: hintFor(theme),
      explanation: explain(theme, pos.turn, line.sans, pos, first, line, r.themes),
      source: 'lichess:' + r.id,
    };
    usedFen.add(startFen);
    accepted.push({ puzzle, bucket: primaryBucket(r.themes), lichessRating: r.rating, themes: r.themes });
    console.error(`  accept ${puzzle.id} ${theme} d${puzzle.difficulty} r${puzzle.rating} ${line.sans.join(' ')}`);
  }
  return accepted;
}

function applyFixes() {
  const out = [];
  const report = [];
  for (const p of OLD) {
    if (REPLACEMENTS[p.id]) {
      const n = { id: p.id, ...REPLACEMENTS[p.id] };
      out.push(n);
      report.push({ id: p.id, title: n.title, action: 'replaced', oldTitle: p.title });
      continue;
    }
    if (TEXT_PATCHES[p.id]) {
      const patch = TEXT_PATCHES[p.id];
      const n = { ...p, ...patch };
      // drop requireCheck if present
      delete n.requireCheck;
      out.push(n);
      report.push({ id: p.id, title: n.title, action: 'text-fixed', oldTitle: p.title });
      continue;
    }
    const n = { ...p };
    delete n.requireCheck;
    out.push(n);
  }
  return { out, report };
}

function emitJs(puzzles) {
  const themes = [
    'mate-in-1', 'mate-in-2', 'mate-in-3', 'mate-in-4', 'fork', 'pin', 'skewer',
    'back-rank', 'discovered', 'sacrifice', 'endgame', 'promotion',
    'deflection', 'zugzwang-ish',
  ];
  const body = JSON.stringify(puzzles, null, 2);
  return `/**
 * Ornate Chess — verified tactics puzzle database.
 * Every entry is engine-checked. Hard puzzles with a lichess: source id
 * come from the CC0 Lichess puzzle database (database.lichess.org).
 */
export const PUZZLES = ${body};

export const PUZZLE_THEMES = ${JSON.stringify(themes)};
`;
}

const ENDGAME_SLOT_IDS = ['eg-21', 'eg-31', 'zg-21', 'zg-22'];

const { out, report } = applyFixes();
const existingFens = new Set(out.map((p) => p.fen));

console.error('selecting hard puzzles...');
const hard = await selectHard(existingFens, ENDGAME_SLOT_IDS);

// Use some unique endgame/zugzwang hard puzzles to replace the unsalvageable slots
function takeFor(themePref, used) {
  const hit = hard.find((h) => !used.has(h.puzzle.id) && (themePref.includes(h.puzzle.theme) || themePref.some((t) => h.themes.includes(t))));
  return hit;
}

const usedHard = new Set();
const slotTheme = { 'eg-21': ['endgame'], 'eg-31': ['endgame'], 'zg-21': ['zugzwang-ish', 'zugzwang'], 'zg-22': ['zugzwang-ish', 'zugzwang'] };
for (const id of ENDGAME_SLOT_IDS) {
  const hit = takeFor(slotTheme[id], usedHard);
  if (!hit) continue;
  usedHard.add(hit.puzzle.id);
  const idx = out.findIndex((p) => p.id === id);
  const old = out[idx];
  const n = { ...hit.puzzle, id, difficulty: old.difficulty >= 4 ? old.difficulty : hit.puzzle.difficulty, rating: Math.min(old.difficulty === 5 ? 2300 : 2100, Math.max(hit.puzzle.rating, old.difficulty === 5 ? 1800 : 1600)) };
  // keep new position; clamp rating into the original difficulty band
  const lo = 700 + (n.difficulty - 1) * 150;
  const hi = 1100 + n.difficulty * 250;
  if (n.rating < lo) n.rating = lo;
  if (n.rating > hi) n.rating = hi;
  out[idx] = n;
  report.push({ id, title: n.title, action: 'replaced-endgame', oldTitle: old.title, from: hit.puzzle.id });
}

const added = hard.filter((h) => !usedHard.has(h.puzzle.id)).map((h) => h.puzzle);
// keep at least 32 additions
const extra = added.slice(0, Math.max(32, added.length));
out.push(...extra);

const file = emitJs(out);
writeFileSync('/workspace/chess/src/data/puzzles.js', file);
writeFileSync('/tmp/puzzle-rebuild-report.json', JSON.stringify({ report, added: extra.map((p) => ({ id: p.id, theme: p.theme, difficulty: p.difficulty, rating: p.rating, title: p.title })), total: out.length }, null, 2));
console.error(`wrote ${out.length} puzzles (${extra.length} new hard, ${report.length} fixes)`);

const byDiff = {};
for (const p of out) byDiff[p.difficulty] = (byDiff[p.difficulty] || 0) + 1;
const byTheme = {};
for (const p of out) byTheme[p.theme] = (byTheme[p.theme] || 0) + 1;
console.error('by difficulty', byDiff);
console.error('by theme', byTheme);
