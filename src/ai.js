/**
 * Chess AI — iterative deepening with PVS, TT (Zobrist), quiescence,
 * null-move, LMR, check extensions, aspiration windows, time control.
 * Uses engine Board make/unmake for speed. No DOM at import time.
 */

import {
  Position,
  Board,
  START_FEN,
  PIECE_VALUES,
  EMPTY,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  BLACK,
  TYPE_CHARS,
  F_CAPTURE,
  F_EP,
  F_PROMO,
  F_KSIDE,
  F_QSIDE,
  F_DOUBLE,
  moveFrom,
  moveTo,
  movePromo,
  moveFlags,
  codeToUci,
  TABLES,
} from './engine.js';

// ---------------------------------------------------------------------------
// Difficulties
// ---------------------------------------------------------------------------

export const DIFFICULTIES = [
  { id: 'lvl1', name: 'Novice',      elo: 400,  depth: 1,  timeMs: 80,   blunderRate: 0.45,  randomness: 180, description: 'Plays one-ply moves with noisy evaluation; frequently overlooks tactics.' },
  { id: 'lvl2', name: 'Beginner',    elo: 700,  depth: 2,  timeMs: 150,  blunderRate: 0.28,  randomness: 120, description: 'Sees short tactics but often hangs material under pressure.' },
  { id: 'lvl3', name: 'Casual',      elo: 1000, depth: 3,  timeMs: 250,  blunderRate: 0.16,  randomness: 70,  description: 'Solid club beginner; uses a small opening book and avoids hanging the queen.' },
  { id: 'lvl4', name: 'Club Player', elo: 1300, depth: 4,  timeMs: 400,  blunderRate: 0.08,  randomness: 40,  description: 'Consistent club strength; rare blunders, basic positional sense.' },
  { id: 'lvl5', name: 'Advanced',    elo: 1600, depth: 5,  timeMs: 700,  blunderRate: 0.04,  randomness: 22,  description: 'Strong club / low expert; finds most two-move tactics.' },
  { id: 'lvl6', name: 'Expert',      elo: 1900, depth: 6,  timeMs: 1100, blunderRate: 0.015, randomness: 12,  description: 'Expert level; deep tactical vision with sound endgame technique.' },
  { id: 'lvl7', name: 'Master',      elo: 2200, depth: 8,  timeMs: 1800, blunderRate: 0.005, randomness: 6,   description: 'Master strength within browser time; rare errors under clock pressure.' },
  { id: 'lvl8', name: 'Grandmaster', elo: 2500, depth: 12, timeMs: 3000, blunderRate: 0,     randomness: 0,   description: 'Full search depth and clean evaluation; as strong as the engine can be in ~3s.' },
];

const DIFF_BY_ID = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d]));

const MATE_SCORE = 100000;
const MATE_BOUND = 90000;
const DRAW_SCORE = 0;
const INF = 1000000;
const TT_EXACT = 0, TT_ALPHA = 1, TT_BETA = 2;

const VAL = [0, 100, 320, 330, 500, 900, 0]; // by piece type index
const PHASE_W = [0, 0, 1, 1, 2, 4, 0];
const PHASE_MAX = 24;

// Piece-square tables indexed [type][sq] for white (a1=0). Black uses sq^56.
const PST_MG = [
  null,
  // pawn
  [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  // knight
  [-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
  // bishop
  [-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
  // rook
  [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  // queen
  [-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
  // king
  [-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20],
];

const PST_EG = [
  null,
  [0,0,0,0,0,0,0,0, 80,80,80,80,80,80,80,80, 50,50,50,50,50,50,50,50, 30,30,30,30,30,30,30,30, 20,20,20,20,20,20,20,20, 10,10,10,10,10,10,10,10, 10,10,10,10,10,10,10,10, 0,0,0,0,0,0,0,0],
  [-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,0,0,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
  [-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
  [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  [-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
  [-50,-40,-30,-20,-20,-30,-40,-50,-30,-20,-10,0,0,-10,-20,-30,-30,-10,20,30,30,20,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,30,40,40,30,-10,-30,-30,-10,20,30,30,20,-10,-30,-30,-30,0,0,0,0,-30,-30,-50,-30,-30,-30,-30,-30,-30,-50],
];

function flip(sq) { return sq ^ 56; }

// ---------------------------------------------------------------------------
// Opening book
// ---------------------------------------------------------------------------

const OPENING_BOOK = [
  ['e2e4','e7e5','g1f3','b8c6','f1b5'],
  ['e2e4','e7e5','g1f3','b8c6','f1c4'],
  ['e2e4','e7e5','g1f3','b8c6','d2d4'],
  ['e2e4','e7e5','b1c3','g8f6','f1c4'],
  ['e2e4','c7c5','g1f3','d7d6','d2d4'],
  ['e2e4','c7c5','g1f3','b8c6','d2d4'],
  ['e2e4','c7c5','b1c3','b8c6','f2f4'],
  ['e2e4','e7e6','d2d4','d7d5','b1c3'],
  ['e2e4','c7c6','d2d4','d7d5','b1c3'],
  ['e2e4','d7d5','e4d5','d8d5','b1c3'],
  ['e2e4','g8f6','e4e5','f6d5','d2d4'],
  ['e2e4','d7d6','d2d4','g8f6','b1c3'],
  ['d2d4','d7d5','c2c4','e7e6','b1c3'],
  ['d2d4','d7d5','c2c4','c7c6','g1f3'],
  ['d2d4','g8f6','c2c4','e7e6','g1f3'],
  ['d2d4','g8f6','c2c4','g7g6','b1c3'],
  ['d2d4','g8f6','c2c4','c7c5','d4d5'],
  ['d2d4','f7f5','g2g3','g8f6','f1g2'],
  ['d2d4','d7d5','g1f3','g8f6','c2c4'],
  ['d2d4','e7e6','c2c4','d7d5','b1c3'],
  ['c2c4','e7e5','b1c3','g8f6','g1f3'],
  ['c2c4','c7c5','b1c3','b8c6','g2g3'],
  ['g1f3','d7d5','g2g3','g8f6','f1g2'],
  ['g1f3','g8f6','c2c4','g7g6','b1c3'],
  ['b2b3','e7e5','c1b2','b8c6','e2e3'],
  ['f2f4','d7d5','g1f3','g8f6','e2e3'],
  ['e2e4','e7e5','f2f4','e5f4','g1f3'],
  ['d2d4','d7d5','c1f4','g8f6','e2e3'],
  ['d2d4','g8f6','c1f4','e7e6','e2e3'],
  ['e2e4','b8c6','d2d4','e7e5','d4e5'],
  ['e2e4','g7g6','d2d4','f8g7','b1c3'],
  ['d2d4','c7c5','d4d5','e7e6','c2c4'],
];

function fenKey4(fen) {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} ${p[3]}`;
}

function bookMoveCode(position) {
  const target = fenKey4(position.toFen());
  const start = Board.fromFen(START_FEN);
  const candidates = [];
  for (const line of OPENING_BOOK) {
    const b = start.clone();
    let i = 0;
    let ok = true;
    for (; i < line.length; i++) {
      if (fenKey4(b.toFen()) === target) break;
      const codes = b.legalCodes();
      let found = -1;
      for (const c of codes) {
        if (codeToUci(c) === line[i]) { found = c; break; }
      }
      if (found < 0) { ok = false; break; }
      b.make(found); b._stack.length = 0;
    }
    if (!ok) continue;
    if (fenKey4(b.toFen()) !== target) continue;
    if (i >= line.length) continue;
    const codes = position.toBoard().legalCodes();
    for (const c of codes) {
      if (codeToUci(c) === line[i]) candidates.push(c);
    }
  }
  if (!candidates.length) return null;
  const uniq = [];
  const seen = new Set();
  for (const c of candidates) {
    const u = codeToUci(c);
    if (!seen.has(u)) { seen.add(u); uniq.push(c); }
  }
  return uniq[(Math.random() * uniq.length) | 0];
}

// ---------------------------------------------------------------------------
// Evaluation on Board (side-relative and white-absolute)
// ---------------------------------------------------------------------------

function evaluateBoardWhite(b) {
  const s = b.sq;
  let mg = 0, eg = 0, phase = 0;
  let wb = 0, bb = 0;
  const pfW = [0,0,0,0,0,0,0,0], pfB = [0,0,0,0,0,0,0,0];
  const pawnsW = [], pawnsB = [];
  let wKing = b.kings[0], bKing = b.kings[1];

  for (let sq = 0; sq < 64; sq++) {
    const p = s[sq];
    if (!p) continue;
    const t = p & 7;
    const black = p & BLACK;
    const idx = black ? flip(sq) : sq;
    const sign = black ? -1 : 1;
    mg += sign * (VAL[t] + PST_MG[t][idx]);
    eg += sign * (VAL[t] + PST_EG[t][idx]);
    phase += PHASE_W[t];
    if (t === BISHOP) { if (black) bb++; else wb++; }
    if (t === PAWN) {
      const f = sq & 7;
      if (black) { pfB[f]++; pawnsB.push(sq); }
      else { pfW[f]++; pawnsW.push(sq); }
    }
  }

  if (wb >= 2) { mg += 30; eg += 50; }
  if (bb >= 2) { mg -= 30; eg -= 50; }

  function pawnStruct(files, pawns, colorIsWhite) {
    let score = 0;
    for (let f = 0; f < 8; f++) {
      if (files[f] > 1) score -= 15 * (files[f] - 1);
      if (files[f] > 0) {
        const L = f > 0 ? files[f - 1] : 0;
        const R = f < 7 ? files[f + 1] : 0;
        if (!L && !R) score -= 12;
      }
    }
    const enemy = colorIsWhite ? pawnsB : pawnsW;
    for (const sq of pawns) {
      const file = sq & 7, rank = sq >> 3;
      let passed = true;
      for (const esq of enemy) {
        const ef = esq & 7, er = esq >> 3;
        if (Math.abs(ef - file) <= 1) {
          if (colorIsWhite && er > rank) { passed = false; break; }
          if (!colorIsWhite && er < rank) { passed = false; break; }
        }
      }
      if (passed) {
        const adv = colorIsWhite ? rank : 7 - rank;
        score += 10 + adv * adv * 4;
      }
    }
    return score;
  }
  const ps = pawnStruct(pfW, pawnsW, true) - pawnStruct(pfB, pawnsB, false);
  mg += ps; eg += ps;

  // King safety (MG only)
  function kingSafety(kingSq, enemySide, ownFiles) {
    if (kingSq < 0) return 0;
    let danger = 0;
    const kf = kingSq & 7, kr = kingSq >> 3;
    const enemyColorBit = enemySide << 3;
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (!dr && !df) continue;
        const r = kr + dr, f = kf + df;
        if (r < 0 || r > 7 || f < 0 || f > 7) continue;
        const p = s[r * 8 + f];
        if (p && (p >> 3) === enemySide) {
          const t = p & 7;
          danger += t === QUEEN ? 8 : t === ROOK ? 5 : (t === KNIGHT || t === BISHOP) ? 3 : 1;
        }
      }
    }
    const shieldRank = enemySide === 1 ? kr + 1 : kr - 1;
    if (shieldRank >= 0 && shieldRank <= 7) {
      for (let df = -1; df <= 1; df++) {
        const f = kf + df;
        if (f < 0 || f > 7) continue;
        const p = s[shieldRank * 8 + f];
        if (!(p && (p & 7) === PAWN && (p >> 3) !== enemySide)) danger += 4;
      }
    }
    for (let df = -1; df <= 1; df++) {
      const f = kf + df;
      if (f < 0 || f > 7) continue;
      if (ownFiles[f] === 0) danger += 6;
    }
    return -danger * 3;
  }
  mg += kingSafety(wKing, 1, pfW);
  mg -= kingSafety(bKing, 0, pfB);

  // Rooks on open/semi-open files + mobility
  const KNIGHT_T = TABLES.KNIGHT;
  const RAYS = TABLES.RAYS;
  let mob = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s[sq];
    if (!p) continue;
    const t = p & 7;
    const us = p >> 3;
    const sign = us ? -1 : 1;
    if (t === ROOK) {
      const file = sq & 7;
      const own = us ? pfB : pfW;
      const enemy = us ? pfW : pfB;
      let bonus = 0;
      if (!own[file] && !enemy[file]) bonus = 20;
      else if (!own[file]) bonus = 10;
      mg += sign * bonus; eg += sign * bonus;
    }
    if (t === KNIGHT) {
      let c = 0;
      const tbl = KNIGHT_T[sq];
      for (let i = 0; i < tbl.length; i++) {
        const q = s[tbl[i]];
        if (!q || (q >> 3) !== us) c++;
      }
      mob += sign * c * 2;
    } else if (t === BISHOP || t === ROOK || t === QUEEN) {
      const d0 = t === BISHOP ? 4 : 0;
      const d1 = t === ROOK ? 4 : 8;
      // for queen both: handle by two ranges if queen
      const ranges = t === QUEEN ? [[0, 8]] : [[d0, d1]];
      let c = 0;
      for (const [a, z] of ranges) {
        for (let d = a; d < z; d++) {
          const ray = RAYS[d][sq];
          for (let i = 0; i < ray.length; i++) {
            const q = s[ray[i]];
            if (!q) { c++; continue; }
            if ((q >> 3) !== us) c++;
            break;
          }
        }
      }
      mob += sign * c * (t === QUEEN ? 1 : 2);
    }
  }
  mg += mob; eg += mob;

  phase = Math.min(PHASE_MAX, phase);
  return (((mg * phase) + (eg * (PHASE_MAX - phase))) / PHASE_MAX) | 0;
}

function evaluateBoardSide(b) {
  const w = evaluateBoardWhite(b);
  return b.side === 0 ? w : -w;
}

/**
 * Static evaluation in centipawns from White's perspective.
 */
export function evaluate(position) {
  if (position.isCheckmate()) return position.turn === 'w' ? -MATE_SCORE : MATE_SCORE;
  if (position.isStalemate() || position.isInsufficientMaterial() || position.isFiftyMoveDraw()) return DRAW_SCORE;
  return evaluateBoardWhite(position._b || position.toBoard());
}

// ---------------------------------------------------------------------------
// Transposition table (Zobrist key = hashHi,hashLo packed loosely)
// ---------------------------------------------------------------------------

class TT {
  constructor(n = 1 << 20) {
    this.mask = n - 1;
    this.keyHi = new Int32Array(n);
    this.keyLo = new Int32Array(n);
    this.depth = new Int16Array(n);
    this.score = new Int32Array(n);
    this.flag = new Uint8Array(n);
    this.move = new Int32Array(n);
    this.used = new Uint8Array(n);
  }
  clear() { this.used.fill(0); }
  idx(b) { return (b.hashLo ^ b.hashHi) & this.mask; }
  store(b, depth, score, flag, move) {
    const i = this.idx(b);
    if (this.used[i] && this.depth[i] > depth) return;
    this.used[i] = 1;
    this.keyHi[i] = b.hashHi;
    this.keyLo[i] = b.hashLo;
    this.depth[i] = depth;
    this.score[i] = score;
    this.flag[i] = flag;
    this.move[i] = move || 0;
  }
  probe(b) {
    const i = this.idx(b);
    if (!this.used[i] || this.keyHi[i] !== b.hashHi || this.keyLo[i] !== b.hashLo) return null;
    return { depth: this.depth[i], score: this.score[i], flag: this.flag[i], move: this.move[i] };
  }
}

// ---------------------------------------------------------------------------
// Move ordering
// ---------------------------------------------------------------------------

function mvvLvaScore(b, m) {
  const fl = m >>> 15;
  if (!(fl & (F_CAPTURE | F_EP))) return 0;
  const to = (m >> 6) & 63;
  const from = m & 63;
  let victim;
  if (fl & F_EP) victim = PAWN;
  else victim = b.sq[to] & 7;
  const attacker = b.sq[from] & 7;
  return VAL[victim] * 16 - VAL[attacker];
}

function orderCodes(b, moves, ttMove, killers, history, ply) {
  const n = moves.length;
  const scored = new Array(n);
  for (let i = 0; i < n; i++) {
    const m = moves[i];
    let s = 0;
    if (m === ttMove) s = 1_000_000;
    else {
      const fl = m >>> 15;
      if (fl & (F_CAPTURE | F_EP)) s = 100_000 + mvvLvaScore(b, m);
      else if (fl & F_PROMO) s = 90_000 + VAL[(m >> 12) & 7];
      else if (killers[ply] && killers[ply][0] === m) s = 80_000;
      else if (killers[ply] && killers[ply][1] === m) s = 70_000;
      else s = history[((m & 63) << 6) | ((m >> 6) & 63)] || 0;
    }
    scored[i] = { m, s };
  }
  scored.sort((a, c) => c.s - a.s);
  for (let i = 0; i < n; i++) moves[i] = scored[i].m;
  return moves;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

class Search {
  constructor() {
    this.tt = new TT(1 << 20);
    this.nodes = 0;
    this.killers = Array.from({ length: 128 }, () => [0, 0]);
    this.history = new Int32Array(64 * 64);
    this.stopAt = 0;
    this.stopped = false;
    this.rep = new Set(); // string keys of prior positions
    this.pv = Array.from({ length: 128 }, () => []);
  }

  shouldStop() {
    if (this.stopped) return true;
    if ((this.nodes & 2047) !== 0) return false;
    if (Date.now() >= this.stopAt) { this.stopped = true; return true; }
    return false;
  }
}

function boardHashKey(b) {
  // Stable key for repetition: placement+side+castle+ep via zobrist parts
  return `${b.hashHi >>> 0}:${b.hashLo >>> 0}`;
}

function isRep(ctx, b) {
  return ctx.rep.has(boardHashKey(b));
}

function hasNonPawn(b) {
  const us = b.side, s = b.sq;
  for (let i = 0; i < 64; i++) {
    const p = s[i];
    if (!p || (p >> 3) !== us) continue;
    const t = p & 7;
    if (t !== PAWN && t !== KING) return true;
  }
  return false;
}

function seeDelta(b, m) {
  const fl = m >>> 15;
  let gain = 0;
  if (fl & F_EP) gain += VAL[PAWN];
  else if (fl & F_CAPTURE) gain += VAL[b.sq[(m >> 6) & 63] & 7];
  const promo = (m >> 12) & 7;
  if (promo) gain += VAL[promo] - VAL[PAWN];
  return gain;
}

function quiesce(ctx, b, alpha, beta, ply) {
  ctx.nodes++;
  if (ctx.shouldStop()) return alpha;

  const inCheck = b.inCheck();
  const stand = evaluateBoardSide(b);
  if (!inCheck) {
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  }

  const moves = inCheck ? b.legalCodes() : b.legalCodes(true);
  if (!moves.length) {
    if (inCheck) return -MATE_SCORE + ply;
    return alpha;
  }
  orderCodes(b, moves, 0, ctx.killers, ctx.history, ply);

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!inCheck && !((m >>> 15) & F_PROMO)) {
      if (stand + seeDelta(b, m) + 200 < alpha) continue;
    }
    b.make(m);
    const score = -quiesce(ctx, b, -beta, -alpha, ply + 1);
    b.unmake(m);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
    if (ctx.stopped) break;
  }
  return alpha;
}

function alphabeta(ctx, b, depth, alpha, beta, ply, allowNull, pvNode) {
  ctx.nodes++;
  if (ctx.shouldStop()) return alpha;

  if (ply > 0 && (isRep(ctx, b) || b.halfmove >= 100)) return DRAW_SCORE;

  // Insufficient material quick check
  if (ply > 0 && isInsufficientBoard(b)) return DRAW_SCORE;

  const inCheck = b.inCheck();
  if (inCheck) depth++;

  if (depth <= 0) return quiesce(ctx, b, alpha, beta, ply);

  const ttHit = ctx.tt.probe(b);
  let ttMove = 0;
  if (ttHit) {
    ttMove = ttHit.move;
    if (ttHit.depth >= depth && ply > 0) {
      if (ttHit.flag === TT_EXACT) return ttHit.score;
      if (ttHit.flag === TT_ALPHA && ttHit.score <= alpha) return alpha;
      if (ttHit.flag === TT_BETA && ttHit.score >= beta) return beta;
    }
  }

  // Mate distance
  const ma = -MATE_SCORE + ply;
  const mb = MATE_SCORE - ply - 1;
  if (alpha < ma) alpha = ma;
  if (beta > mb) beta = mb;
  if (alpha >= beta) return alpha;

  // Null move
  if (allowNull && !inCheck && !pvNode && depth >= 3 && hasNonPawn(b)) {
    const R = depth > 6 ? 3 : 2;
    b.makeNull();
    const score = -alphabeta(ctx, b, depth - 1 - R, -beta, -beta + 1, ply + 1, false, false);
    b.unmakeNull();
    if (score >= beta) return beta;
  }

  const moves = b.legalCodes();
  if (!moves.length) return inCheck ? -MATE_SCORE + ply : DRAW_SCORE;

  orderCodes(b, moves, ttMove, ctx.killers, ctx.history, ply);

  let bestMove = 0;
  let bestScore = -INF;
  let flag = TT_ALPHA;
  let legal = 0;

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const fl = m >>> 15;
    const isQuiet = !(fl & (F_CAPTURE | F_EP | F_PROMO));

    b.make(m);
    legal++;

    let score;
    const newDepth = depth - 1;

    if (!pvNode && depth >= 3 && i >= 3 && isQuiet && !inCheck && !b.inCheck()) {
      const R = 1 + (i > 6 ? 1 : 0);
      score = -alphabeta(ctx, b, newDepth - R, -alpha - 1, -alpha, ply + 1, true, false);
      if (score > alpha) {
        score = -alphabeta(ctx, b, newDepth, -alpha - 1, -alpha, ply + 1, true, false);
      }
    } else if (pvNode && legal === 1) {
      score = -alphabeta(ctx, b, newDepth, -beta, -alpha, ply + 1, true, true);
    } else {
      score = -alphabeta(ctx, b, newDepth, -alpha - 1, -alpha, ply + 1, true, false);
      if (score > alpha && score < beta) {
        score = -alphabeta(ctx, b, newDepth, -beta, -alpha, ply + 1, true, true);
      }
    }
    b.unmake(m);

    if (ctx.stopped) break;

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
      ctx.pv[ply] = [m, ...(ctx.pv[ply + 1] || [])];
    }
    if (score > alpha) {
      alpha = score;
      flag = TT_EXACT;
      if (score >= beta) {
        flag = TT_BETA;
        if (isQuiet) {
          const k = ctx.killers[ply];
          if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
          const h = ((m & 63) << 6) | ((m >> 6) & 63);
          ctx.history[h] += depth * depth;
        }
        break;
      }
    }
  }

  ctx.tt.store(b, depth, bestScore, flag, bestMove);
  return bestScore;
}

function isInsufficientBoard(b) {
  const s = b.sq;
  let minors = 0, knights = 0, bishopColors = 0;
  for (let i = 0; i < 64; i++) {
    const t = s[i] & 7;
    if (!t || t === KING) continue;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    minors++;
    if (t === KNIGHT) knights++;
    else bishopColors |= (((i & 7) + (i >> 3)) & 1) ? 1 : 2;
  }
  if (minors <= 1) return true;
  return knights === 0 && bishopColors !== 3;
}

function collectRep(history) {
  const set = new Set();
  if (!history) return set;
  for (const p of history) {
    try {
      if (p && typeof p.toBoard === 'function') set.add(boardHashKey(p.toBoard()));
      else if (p && p.hashHi !== undefined) set.add(boardHashKey(p));
      else if (typeof p === 'string') set.add(boardHashKey(Board.fromFen(p)));
      else if (p && p._b) set.add(boardHashKey(p._b));
    } catch { /* ignore */ }
  }
  return set;
}

function iterativeDeepening(board, maxDepth, timeMs, history, signal) {
  const ctx = new Search();
  const started = Date.now();
  ctx.stopAt = started + Math.max(10, timeMs);
  ctx.rep = collectRep(history);
  ctx.nodes = 0;
  ctx.stopped = false;

  if (signal) {
    if (signal.aborted) ctx.stopped = true;
    else if (typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => { ctx.stopped = true; });
    }
  }

  const rootMoves = board.legalCodes();
  if (!rootMoves.length) {
    return { moveCode: 0, score: evaluateBoardSide(board), depth: 0, nodes: 0, pv: [], _nps: 0 };
  }
  if (rootMoves.length === 1) {
    return { moveCode: rootMoves[0], score: 0, depth: 0, nodes: 1, pv: [rootMoves[0]], _nps: 1 };
  }

  let bestMove = rootMoves[0];
  let bestScore = 0;
  let bestDepth = 0;
  let pv = [bestMove];
  const ASP = 40;

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (ctx.shouldStop() && depth > 1) break;

    let alpha = depth >= 3 ? bestScore - ASP : -INF;
    let beta = depth >= 3 ? bestScore + ASP : INF;
    let score;
    let fails = 0;

    for (;;) {
      ctx.pv = Array.from({ length: 128 }, () => []);
      score = alphabeta(ctx, board, depth, alpha, beta, 0, true, true);
      if (ctx.stopped && depth > 1) break;
      if (score <= alpha) { alpha = -INF; fails++; if (fails > 2) break; continue; }
      if (score >= beta) { beta = INF; fails++; if (fails > 2) break; continue; }
      break;
    }

    if (ctx.stopped && depth > 1 && !(ctx.pv[0] && ctx.pv[0].length)) break;

    if (ctx.pv[0] && ctx.pv[0].length) {
      bestMove = ctx.pv[0][0];
      pv = ctx.pv[0].slice();
      bestScore = score;
      bestDepth = depth;
    }

    const elapsed = Date.now() - started;
    const remaining = ctx.stopAt - Date.now();
    if (remaining < elapsed * 0.4 && depth >= 2) { ctx.stopped = true; break; }
    if (Math.abs(bestScore) >= MATE_BOUND) break;
  }

  if (!rootMoves.includes(bestMove)) bestMove = rootMoves[0];

  const elapsedSec = Math.max(0.001, (Date.now() - started) / 1000);
  return {
    moveCode: bestMove,
    score: bestScore,
    depth: bestDepth,
    nodes: ctx.nodes,
    pv,
    _nps: ctx.nodes / elapsedSec,
  };
}

// ---------------------------------------------------------------------------
// Weakness / helpers on Position (public move objects)
// ---------------------------------------------------------------------------

function codeToMoveObj(pos, code) {
  return pos.codeToMove(code);
}

function picksMateInOneCode(pos) {
  const b = pos.toBoard();
  const moves = b.legalCodes();
  for (const m of moves) {
    b.make(m);
    const mate = b.legalCodes().length === 0 && b.inCheck();
    b.unmake(m);
    if (mate) return m;
  }
  return 0;
}

function isHangingQueen(pos, moveObj) {
  if (moveObj.piece !== 'q') return false;
  if (moveObj.captured === 'q') return false;
  const child = pos.makeMove(moveObj);
  for (const r of child.legalMoves()) {
    if (r.to === moveObj.to && r.captured === 'q') {
      if (!moveObj.captured || PIECE_VALUES[moveObj.captured] < PIECE_VALUES.q - 100) return true;
    }
  }
  return false;
}

function scoreRootMoves(pos, depth, timeMs, history) {
  const legal = pos.legalMoves();
  const budget = Math.max(20, (timeMs / Math.max(1, legal.length)) | 0);
  const results = [];
  for (const m of legal) {
    const child = pos.makeMove(m);
    let score;
    if (depth <= 1) {
      score = -evaluateBoardSide(child._b);
    } else {
      const r = iterativeDeepening(child.toBoard(), Math.max(1, depth - 1), budget, history, null);
      score = -r.score;
    }
    results.push({ move: m, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

function applyWeakness(pos, ranked, diff) {
  if (!ranked.length) return null;
  const lvlNum = Number(String(diff.id).replace('lvl', '')) || 1;

  if (lvlNum > 2) {
    const mate = picksMateInOneCode(pos);
    if (mate) return pos.codeToMove(mate);
  } else {
    const mate = picksMateInOneCode(pos);
    if (mate && Math.random() < 0.7) return pos.codeToMove(mate);
  }

  let pool = ranked;
  if (lvlNum >= 3) {
    const f = ranked.filter((r) => !isHangingQueen(pos, r.move));
    if (f.length) pool = f;
  }
  if (lvlNum >= 3) {
    const best = pool[0] || ranked[0];
    const f = pool.filter((r) => r.score > best.score - 600);
    if (f.length) pool = f;
  }

  if (diff.blunderRate > 0 && Math.random() < diff.blunderRate && pool.length > 1) {
    const start = Math.min(1, pool.length - 1);
    const end = Math.max(start + 1, Math.ceil(pool.length * 0.6));
    const slice = pool.slice(start, end);
    return slice[(Math.random() * slice.length) | 0].move;
  }

  if (diff.randomness > 0) {
    const best = pool[0];
    const window = pool.filter((r) => r.score >= best.score - diff.randomness);
    if (window.length) {
      const weights = window.map((_, i) => 1 / (1 + i * 0.5));
      const sum = weights.reduce((a, c) => a + c, 0);
      let t = Math.random() * sum;
      for (let i = 0; i < window.length; i++) {
        t -= weights[i];
        if (t <= 0) return window[i].move;
      }
      return window[0].move;
    }
  }
  return pool[0].move;
}

function sameMove(a, b) {
  if (!a || !b) return false;
  return a.from === b.from && a.to === b.to && (a.promotion || '') === (b.promotion || '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function chooseMove(position, options = {}) {
  const diff = DIFF_BY_ID[options.difficultyId] || DIFF_BY_ID.lvl4;
  const timeMs = options.timeMs ?? diff.timeMs;
  const history = options.history || [];
  const signal = options.signal;

  await Promise.resolve();
  if (signal?.aborted) {
    const moves = position.legalMoves();
    return { move: moves[0] || null, score: 0, depth: 0, nodes: 0, pv: [] };
  }

  const legal = position.legalMoves();
  if (!legal.length) {
    return { move: null, score: evaluateBoardSide(position._b), depth: 0, nodes: 0, pv: [] };
  }

  const lvlNum = Number(String(diff.id).replace('lvl', '')) || 1;
  if (lvlNum >= 3 && history.length < 12) {
    const code = bookMoveCode(position);
    if (code) {
      const mv = position.codeToMove(code);
      return { move: mv, score: 15, depth: 0, nodes: 0, pv: [mv] };
    }
  }

  if (diff.depth <= 2 || diff.blunderRate > 0.1 || diff.randomness > 50) {
    const ranked = scoreRootMoves(position, diff.depth, timeMs, history);
    const move = applyWeakness(position, ranked, diff) || ranked[0].move;
    const entry = ranked.find((r) => sameMove(r.move, move)) || ranked[0];
    return { move, score: entry.score, depth: diff.depth, nodes: legal.length, pv: [move] };
  }

  const result = iterativeDeepening(position.toBoard(), diff.depth, timeMs, history, signal);
  let move = result.moveCode ? position.codeToMove(result.moveCode) : legal[0];

  // Always prefer mate in one above lvl2 (and for elite levels).
  const mate = picksMateInOneCode(position);
  if (mate && lvlNum > 2) move = position.codeToMove(mate);

  // Mild weakness: only randomly downgrade using shallow root scores for the
  // searched best vs a few alternatives — never promote a static-eval move
  // above the searched principal variation.
  if (lvlNum < 7 && (diff.blunderRate > 0 || diff.randomness > 0) && !mate) {
    if (diff.blunderRate > 0 && Math.random() < diff.blunderRate) {
      const ranked = scoreRootMoves(position, Math.min(3, diff.depth), Math.min(timeMs, 200), history);
      const filtered = ranked.filter((r) => r.score > ranked[0].score - 400 && !isHangingQueen(position, r.move));
      if (filtered.length > 1) {
        const start = 1;
        const end = Math.min(filtered.length, 4);
        move = filtered[start + ((Math.random() * (end - start)) | 0)].move;
      }
    } else if (diff.randomness > 0 && Math.random() < 0.35) {
      // Occasional near-best alternative via 1-ply eval, within randomness cp
      const alts = [];
      for (const m of legal) {
        const sc = -evaluateBoardSide(position.makeMove(m)._b);
        if (sc >= result.score - diff.randomness) alts.push({ move: m, score: sc });
      }
      alts.sort((a, b) => b.score - a.score);
      if (alts.length > 1 && alts[0].score <= result.score + 30) {
        // Prefer keeping search move; sometimes pick 2nd
        if (Math.random() < 0.4 && alts.length > 1) move = alts[Math.min(1, alts.length - 1)].move;
      }
    }
  }

  const pvMoves = [];
  let p = position;
  for (const c of result.pv || []) {
    try {
      const mv = p.codeToMove(c);
      pvMoves.push(mv);
      p = p.makeMove(mv);
    } catch { break; }
  }
  if (!pvMoves.length) pvMoves.push(move);

  return {
    move,
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    pv: pvMoves,
  };
}

export async function analyze(position, opts = {}) {
  await Promise.resolve();
  const multiPv = Math.max(1, Math.min(5, opts.multiPv || 1));
  const depth = opts.depth || 4;
  const timeMs = opts.timeMs || 800;
  const legal = position.legalMoves();
  if (!legal.length) return [];

  const per = Math.max(30, (timeMs / multiPv) | 0);
  const scored = [];
  for (const m of legal) {
    const child = position.makeMove(m);
    const r = iterativeDeepening(child.toBoard(), Math.max(1, depth - 1), per, null, null);
    const pv = [m];
    let p = child;
    for (const c of r.pv || []) {
      try {
        const mv = p.codeToMove(c);
        pv.push(mv);
        p = p.makeMove(mv);
      } catch { break; }
    }
    scored.push({ move: m, score: -r.score, pv, nodes: r.nodes });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, multiPv).map(({ move, score, pv }) => ({ move, score, pv }));
}

export function _benchmarkNps(position, timeMs = 500) {
  const r = iterativeDeepening(position.toBoard(), 12, timeMs, null, null);
  return { nodes: r.nodes, nps: Math.round(r._nps || 0), depth: r.depth, move: r.moveCode ? codeToUci(r.moveCode) : null };
}
