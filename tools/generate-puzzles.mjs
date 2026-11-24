/**
 * Generate mate-in-N and simple tactical puzzles using the engine.
 * Keeps positions where the mating move (or tactic) is unique, or lists alternatives.
 *
 * Usage: node tools/generate-puzzles.mjs
 * Writes candidates to tools/generated-candidates.json
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { Position, PIECE_VALUES } from '../src/engine.js';

const FILES = 'abcdefgh';
function sq(name) {
  return FILES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
}
function uci(from, to, promo) {
  return FILES[from % 8] + (1 + Math.floor(from / 8)) + FILES[to % 8] + (1 + Math.floor(to / 8)) + (promo || '');
}

/** Brute-force: find all moves that mate immediately. */
function mateIn1Moves(pos) {
  const out = [];
  for (const m of pos.legalMoves()) {
    const c = pos.makeMove(m);
    if (c.isCheckmate()) out.push(pos.moveToUci(m));
  }
  return out;
}

/** Find moves that force mate in 2 (every reply allows a mate-in-1). */
function mateIn2Moves(pos) {
  const out = [];
  for (const m of pos.legalMoves()) {
    const c = pos.makeMove(m);
    if (c.isCheckmate()) {
      out.push(pos.moveToUci(m)); // mate in 1 also fine for generation filter later
      continue;
    }
    if (c.isStalemate()) continue;
    const replies = c.legalMoves();
    if (!replies.length) continue;
    let ok = true;
    const line = [pos.moveToUci(m)];
    let replyUci = null;
    let finishUci = null;
    for (const r of replies) {
      const after = c.makeMove(r);
      const mates = mateIn1Moves(after);
      if (!mates.length) {
        ok = false;
        break;
      }
      if (!replyUci) {
        replyUci = c.moveToUci(r);
        finishUci = mates[0];
      }
    }
    if (ok) out.push({ first: pos.moveToUci(m), sampleReply: replyUci, finish: finishUci });
  }
  return out;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Build a sparse random-ish position from piece templates biased toward mates. */
function place(board, square, color, type) {
  board[square] = { color, type };
}

function emptyBoard() {
  return Array(64).fill(null);
}

function boardToFen(board, turn = 'w', castling = '-', ep = '-', half = 0, full = 1) {
  let fen = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = board[rank * 8 + file];
      if (!p) empty++;
      else {
        if (empty) {
          fen += empty;
          empty = 0;
        }
        const ch = p.type;
        fen += p.color === 'w' ? ch.toUpperCase() : ch;
      }
    }
    if (empty) fen += empty;
    if (rank > 0) fen += '/';
  }
  return `${fen} ${turn} ${castling} ${ep} ${half} ${full}`;
}

/** Template: back-rank mate patterns */
function* backRankTemplates() {
  // White rook on e-file mates on e8; black king g8 with f7g7h7 pawns
  {
    const b = emptyBoard();
    place(b, sq('g1'), 'w', 'k');
    place(b, sq('e1'), 'w', 'r');
    place(b, sq('f2'), 'w', 'p');
    place(b, sq('g2'), 'w', 'p');
    place(b, sq('h2'), 'w', 'p');
    place(b, sq('g8'), 'b', 'k');
    place(b, sq('f7'), 'b', 'p');
    place(b, sq('g7'), 'b', 'p');
    place(b, sq('h7'), 'b', 'p');
    yield { fen: boardToFen(b, 'w'), theme: 'mate-in-1', difficulty: 1, title: 'Back-rank mate with rook', hint: 'Use the open file to reach the eighth rank.', explanation: 'The rook delivers checkmate on e8 because the black king is trapped behind its own pawns.' };
  }
  // Queen back-rank
  {
    const b = emptyBoard();
    place(b, sq('g1'), 'w', 'k');
    place(b, sq('a1'), 'w', 'q');
    place(b, sq('f2'), 'w', 'p');
    place(b, sq('g2'), 'w', 'p');
    place(b, sq('h2'), 'w', 'p');
    place(b, sq('g8'), 'b', 'k');
    place(b, sq('f7'), 'b', 'p');
    place(b, sq('g7'), 'b', 'p');
    place(b, sq('h7'), 'b', 'p');
    place(b, sq('a8'), 'b', 'r'); // decoy but queen can still mate on d8? actually Qa8 captures? 
    // Better: queen to d8 mate if a8 empty
    b[sq('a8')] = null;
    yield { fen: boardToFen(b, 'w'), theme: 'mate-in-1', difficulty: 1, title: 'Back-rank mate with queen', hint: 'The eighth rank is undefended.', explanation: 'Queen to d8 checkmates because the black king cannot escape the back rank.' };
  }
}

/** Two-rook mate ladder seeds */
function* ladderTemplates() {
  {
    const b = emptyBoard();
    place(b, sq('a1'), 'w', 'r');
    place(b, sq('b2'), 'w', 'r');
    place(b, sq('g1'), 'w', 'k');
    place(b, sq('a8'), 'b', 'k');
    yield { fen: boardToFen(b, 'w'), theme: 'mate-in-2', difficulty: 2, title: 'Ladder mate pattern', hint: 'Drive the king with alternating rook checks.', explanation: 'The two rooks cut consecutive ranks until the king is mated on the edge.' };
  }
}

/** King+Queen vs King mate-in-1/2 endgames */
function* kqKTemplates() {
  const wk = sq('f3');
  const wq = sq('a4');
  const bk = sq('f5');
  const b = emptyBoard();
  place(b, wk, 'w', 'k');
  place(b, wq, 'w', 'q');
  place(b, bk, 'b', 'k');
  yield { fen: boardToFen(b, 'w'), theme: 'endgame', difficulty: 2, title: 'Queen checkmate pattern', hint: 'Place the queen adjacent to the king with protection.', explanation: 'With the white king supporting, the queen mates on the adjacent square.' };
}

/** Knight forks */
function* forkTemplates() {
  // White knight on c3 can jump to d5/e4/b5 etc — classic: N forks king and queen
  {
    const b = emptyBoard();
    place(b, sq('e1'), 'w', 'k');
    place(b, sq('c4'), 'w', 'n');
    place(b, sq('e8'), 'b', 'k');
    place(b, sq('d6'), 'b', 'q');
    place(b, sq('b6'), 'b', 'r');
    // Nc4-d6? d6 has queen — Nxd6 isn't fork. Fork: Ne5? from c4: a3,a5,b2,b6,d2,d6,e3,e5
    // Put king on e8 and queen/rook on squares forked from e5: d7,f7,c6,c4,d3,f3,g6,g4 — 
    // Better classic: white knight f7 forks king d8 and rook h8
  }
  {
    const b = emptyBoard();
    place(b, sq('g1'), 'w', 'k');
    place(b, sq('e5'), 'w', 'n');
    place(b, sq('e8'), 'b', 'k');
    place(b, sq('d7'), 'b', 'q');
    place(b, sq('f7'), 'b', 'r');
    place(b, sq('a7'), 'b', 'p');
    place(b, sq('b7'), 'b', 'p');
    place(b, sq('c7'), 'b', 'p');
    // Ne5-d7 or f7 or c6/g6 — Nd7 forks king and? king e8 attacked by Nd7, queen is ON d7.
    // Nf7: attacks d8,d6,e5,g5,h6,h8,g9 invalid — from f7: d6,d8,e5,g5,h6,h8,g9,e9
    // King e8 is attacked by Nf7? e8 is knight from f7? delta file -1 rank +1 = not knight move.
    // Classic smothered/fork: White Nc7 forks king a8 and rook a8? 
  }
  {
    // White to move: knight on c3, black king e8, black queen a5, black rook e4 — Ne4? 
    // Use: knight g5, black king e8, queen e7, rook h7 — Nf7 forks king and rook
    const b = emptyBoard();
    place(b, sq('e1'), 'w', 'k');
    place(b, sq('g5'), 'w', 'n');
    place(b, sq('e8'), 'b', 'k');
    place(b, sq('h8'), 'b', 'r');
    place(b, sq('d8'), 'b', 'q');
    place(b, sq('f8'), 'b', 'b');
    place(b, sq('a7'), 'b', 'p');
    place(b, sq('b7'), 'b', 'p');
    place(b, sq('c7'), 'b', 'p');
    place(b, sq('d7'), 'b', 'p');
    place(b, sq('f7'), 'b', 'p');
    place(b, sq('g7'), 'b', 'p');
    place(b, sq('h7'), 'b', 'p');
    // Nf7 forks king (check) and rook h8
    yield { fen: boardToFen(b, 'w'), theme: 'fork', difficulty: 2, title: 'Knight forks king and rook', hint: 'Look for a check that also attacks the corner rook.', explanation: 'Knight to f7 checks the king and attacks the rook on h8 at the same time.' };
  }
}

function analyzeFen(fen, themeHint) {
  let pos;
  try {
    pos = Position.fromFen(fen);
  } catch {
    return null;
  }
  if (pos.isCheckmate() || pos.isStalemate()) return null;

  const m1 = mateIn1Moves(pos);
  if (m1.length) {
    return {
      fen: pos.toFen(),
      theme: themeHint || 'mate-in-1',
      solution: [m1[0]],
      alternatives: m1.length > 1 ? [m1.slice(1)] : undefined,
      mateMoves: m1,
    };
  }
  const m2 = mateIn2Moves(pos);
  if (m2.length === 1 || (m2.length > 0 && m2.length <= 3)) {
    const best = m2[0];
    if (typeof best === 'string') {
      return { fen: pos.toFen(), theme: 'mate-in-1', solution: [best] };
    }
    // Build full line with one sample reply
    const first = best.first;
    const c = pos.makeMove(pos.parseUci(first));
    // Pick a reply and mate
    const replies = c.legalMoves();
    if (!replies.length) return null;
    const r = replies[0];
    const after = c.makeMove(r);
    const mates = mateIn1Moves(after);
    if (!mates.length) return null;
    return {
      fen: pos.toFen(),
      theme: themeHint || 'mate-in-2',
      solution: [first, c.moveToUci(r), mates[0]],
      alternatives: m2.length > 1 ? [m2.map((x) => x.first || x)] : undefined,
    };
  }
  return null;
}

const candidates = [];
for (const t of [...backRankTemplates(), ...ladderTemplates(), ...kqKTemplates(), ...forkTemplates()]) {
  const result = analyzeFen(t.fen, t.theme);
  if (result) {
    candidates.push({
      ...t,
      ...result,
      difficulty: t.difficulty || 1,
      rating: 800 + (t.difficulty || 1) * 200,
    });
  } else {
    // still keep template if we can at least verify solution manually later
    candidates.push({ ...t, needsManualSolution: true });
  }
}

// Random search: sprinkle kings + heavy pieces and look for mates
let attempts = 0;
const found = [];
while (found.length < 40 && attempts < 5000) {
  attempts++;
  const b = emptyBoard();
  // Place kings far apart-ish
  const wk = Math.floor(Math.random() * 64);
  let bk = Math.floor(Math.random() * 64);
  while (bk === wk || Math.abs((bk % 8) - (wk % 8)) <= 1 && Math.abs(Math.floor(bk / 8) - Math.floor(wk / 8)) <= 1) {
    bk = Math.floor(Math.random() * 64);
  }
  place(b, wk, 'w', 'k');
  place(b, bk, 'b', 'k');
  const pool = ['q', 'r', 'r', 'n', 'b', 'p', 'p'];
  const nPieces = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < nPieces; i++) {
    let s = Math.floor(Math.random() * 64);
    let guard = 0;
    while (b[s] && guard++ < 20) s = Math.floor(Math.random() * 64);
    if (b[s]) continue;
    const type = randomChoice(pool);
    const color = Math.random() < 0.7 ? 'w' : 'b';
    if (type === 'p' && (Math.floor(s / 8) === 0 || Math.floor(s / 8) === 7)) continue;
    place(b, s, color, type);
  }
  const turn = 'w';
  const fen = boardToFen(b, turn);
  try {
    const pos = Position.fromFen(fen);
    // Reject if side to move already in check from illegal placement... fromFen should allow; legalMoves handles.
    // Actually illegal (both in check etc.) — skip if king can be captured... engine should validate.
    if (pos.inCheck() && pos.legalMoves().length === 0 && !pos.isCheckmate()) continue;
    const m1 = mateIn1Moves(pos);
    if (m1.length >= 1 && m1.length <= 3) {
      found.push({
        fen: pos.toFen(),
        theme: 'mate-in-1',
        difficulty: m1.length === 1 ? 1 : 2,
        rating: m1.length === 1 ? 900 : 1100,
        solution: [m1[0]],
        alternatives: m1.length > 1 ? [m1.slice()] : undefined,
        title: 'Mate in one',
        hint: 'Find a move that leaves the opposing king with no escape.',
        explanation: 'The solution delivers checkmate in a single move.',
        mateMoves: m1,
      });
      continue;
    }
    const m2 = mateIn2Moves(pos);
    const forcing = m2.filter((x) => typeof x === 'object');
    if (forcing.length === 1) {
      const best = forcing[0];
      const first = best.first;
      const c = pos.makeMove(pos.parseUci(first));
      const replies = c.legalMoves();
      // Prefer shortest sample line: take first reply
      const r = replies[0];
      const after = c.makeMove(r);
      const mates = mateIn1Moves(after);
      if (mates.length) {
        found.push({
          fen: pos.toFen(),
          theme: 'mate-in-2',
          difficulty: 3,
          rating: 1400,
          solution: [first, c.moveToUci(r), mates[0]],
          title: 'Mate in two',
          hint: 'Force a position where mate cannot be avoided next move.',
          explanation: 'After the forcing move, every defense allows mate on the following turn.',
        });
      }
    }
  } catch {
    /* invalid */
  }
}

const all = [...candidates.filter((c) => c.solution), ...found];
// Dedup by fen
const seen = new Set();
const unique = [];
for (const p of all) {
  const key = p.fen.split(' ').slice(0, 2).join(' ');
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(p);
}

writeFileSync(
  new URL('./generated-candidates.json', import.meta.url),
  JSON.stringify({ count: unique.length, attempts, puzzles: unique }, null, 2)
);
console.log(`Generated ${unique.length} candidates from ${attempts} random attempts + templates`);
