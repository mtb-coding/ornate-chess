// Ornate Chess rules engine: board representation, legal move generation,
// FEN, UCI, SAN, PGN, JSON and game-result logic. Pure ES module, no DOM.
//
// Internally a mutable 64-square mailbox `Board` with make/unmake and
// incremental Zobrist hashing is used (exported for the search). The public
// `Position` class wraps a Board immutably, as required by CONTRACT.md.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const PIECE_VALUES = Object.freeze({ p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 });

// ---- piece codes: type | (color << 3); white = 0, black = 1 ----
export const EMPTY = 0, PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6, BLACK = 8;
export const TYPE_CHARS = ['', 'p', 'n', 'b', 'r', 'q', 'k'];
const TYPE_INDEX = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };

// ---- move encoding: from | to<<6 | promoType<<12 | flags<<15 ----
export const F_CAPTURE = 1, F_EP = 2, F_KSIDE = 4, F_QSIDE = 8, F_PROMO = 16, F_DOUBLE = 32;
export function encodeMove(from, to, promo = 0, flags = 0) { return from | (to << 6) | (promo << 12) | (flags << 15); }
export const moveFrom = (m) => m & 63;
export const moveTo = (m) => (m >> 6) & 63;
export const movePromo = (m) => (m >> 12) & 7;
export const moveFlags = (m) => m >>> 15;

const FILES = 'abcdefgh';
export function squareName(sq) { return FILES[sq & 7] + ((sq >> 3) + 1); }
export function parseSquare(name) {
  if (typeof name !== 'string' || !/^[a-h][1-8]$/.test(name)) return null;
  return (name.charCodeAt(0) - 97) + 8 * (name.charCodeAt(1) - 49);
}

// ---- precomputed tables ----
const KNIGHT_T = [], KING_T = [], PAWN_ATT = [[], []];
const RAYS = []; // RAYS[dir][sq] -> array of squares; dirs 0-3 orthogonal, 4-7 diagonal
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
for (let d = 0; d < 8; d++) RAYS.push([]);
for (let sq = 0; sq < 64; sq++) {
  const f = sq & 7, r = sq >> 3;
  const add = (arr, df, dr) => { const nf = f + df, nr = r + dr; if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) arr.push(nr * 8 + nf); };
  const kn = []; for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) add(kn, df, dr);
  KNIGHT_T.push(kn);
  const kg = []; for (const [df, dr] of DIRS) add(kg, df, dr);
  KING_T.push(kg);
  const pw = []; add(pw, -1, 1); add(pw, 1, 1); PAWN_ATT[0].push(pw);
  const pb = []; add(pb, -1, -1); add(pb, 1, -1); PAWN_ATT[1].push(pb);
  for (let d = 0; d < 8; d++) {
    const ray = []; let nf = f + DIRS[d][0], nr = r + DIRS[d][1];
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) { ray.push(nr * 8 + nf); nf += DIRS[d][0]; nr += DIRS[d][1]; }
    RAYS[d].push(ray);
  }
}
export const TABLES = { KNIGHT: KNIGHT_T, KING: KING_T, PAWN_ATTACKS: PAWN_ATT, RAYS };

// castling bits: 1 = wK, 2 = wQ, 4 = bK, 8 = bQ
const CASTLE_MASK = new Int8Array(64).fill(15);
CASTLE_MASK[4] = 15 & ~3; CASTLE_MASK[7] = 15 & ~1; CASTLE_MASK[0] = 15 & ~2;
CASTLE_MASK[60] = 15 & ~12; CASTLE_MASK[63] = 15 & ~4; CASTLE_MASK[56] = 15 & ~8;

// ---- zobrist keys (deterministic PRNG) ----
let seed = 0x9e3779b9;
function rnd32() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (t ^ (t >>> 14)) | 0; }
const ZP_LO = new Int32Array(16 * 64), ZP_HI = new Int32Array(16 * 64);
for (let i = 0; i < 16 * 64; i++) { ZP_LO[i] = rnd32(); ZP_HI[i] = rnd32(); }
const ZC_LO = new Int32Array(16), ZC_HI = new Int32Array(16);
for (let i = 0; i < 16; i++) { ZC_LO[i] = rnd32(); ZC_HI[i] = rnd32(); }
const ZE_LO = new Int32Array(8), ZE_HI = new Int32Array(8);
for (let i = 0; i < 8; i++) { ZE_LO[i] = rnd32(); ZE_HI[i] = rnd32(); }
const ZS_LO = rnd32(), ZS_HI = rnd32();

const PIECE_OBJ = [];
for (let c = 0; c < 16; c++) {
  const t = c & 7; PIECE_OBJ.push(t >= 1 && t <= 6 ? Object.freeze({ color: c & 8 ? 'b' : 'w', type: TYPE_CHARS[t] }) : null);
}

// =====================================================================
// Board: mutable, fast. Used by Position internally and by the search.
// =====================================================================
export class Board {
  constructor() {
    this.sq = new Int8Array(64);
    this.side = 0;        // 0 white, 1 black
    this.castle = 0;      // bitmask
    this.ep = -1;         // en passant target square or -1
    this.halfmove = 0;
    this.fullmove = 1;
    this.kings = [-1, -1];
    this.hashLo = 0; this.hashHi = 0;
    this._stack = [];
  }

  clone() {
    const b = new Board();
    b.sq = this.sq.slice(); b.side = this.side; b.castle = this.castle; b.ep = this.ep;
    b.halfmove = this.halfmove; b.fullmove = this.fullmove; b.kings = this.kings.slice();
    b.hashLo = this.hashLo; b.hashHi = this.hashHi;
    return b;
  }

  static fromFen(fen) {
    if (typeof fen !== 'string') throw new Error('Invalid FEN: expected a string.');
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4 || parts.length > 6) throw new Error('Invalid FEN: expected 4 to 6 space-separated fields.');
    const [place, stm, cast, ep, hm = '0', fm = '1'] = parts;
    const b = new Board();
    const ranks = place.split('/');
    if (ranks.length !== 8) throw new Error('Invalid FEN: the piece placement must contain 8 ranks.');
    for (let i = 0; i < 8; i++) {
      const r = 7 - i; let f = 0;
      for (const ch of ranks[i]) {
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        const t = TYPE_INDEX[ch.toLowerCase()];
        if (!t) throw new Error(`Invalid FEN: unknown piece character "${ch}".`);
        if (f > 7) throw new Error(`Invalid FEN: rank ${r + 1} has more than 8 squares.`);
        b.sq[r * 8 + f] = t | (ch === ch.toLowerCase() ? BLACK : 0);
        f++;
      }
      if (f !== 8) throw new Error(`Invalid FEN: rank ${r + 1} does not contain exactly 8 squares.`);
    }
    if (stm !== 'w' && stm !== 'b') throw new Error('Invalid FEN: the side to move must be "w" or "b".');
    b.side = stm === 'w' ? 0 : 1;
    let wk = 0, bk = 0;
    for (let s = 0; s < 64; s++) {
      const p = b.sq[s];
      if (p === KING) { wk++; b.kings[0] = s; }
      if (p === (KING | BLACK)) { bk++; b.kings[1] = s; }
      if ((p & 7) === PAWN && (s < 8 || s >= 56)) throw new Error('Invalid FEN: pawns cannot stand on the first or last rank.');
    }
    if (wk !== 1 || bk !== 1) throw new Error('Invalid FEN: each side must have exactly one king.');
    if (!/^(-|[KQkq]{1,4})$/.test(cast)) throw new Error('Invalid FEN: the castling field is malformed.');
    let c = 0;
    if (cast.includes('K') && b.sq[4] === KING && b.sq[7] === ROOK) c |= 1;
    if (cast.includes('Q') && b.sq[4] === KING && b.sq[0] === ROOK) c |= 2;
    if (cast.includes('k') && b.sq[60] === (KING | BLACK) && b.sq[63] === (ROOK | BLACK)) c |= 4;
    if (cast.includes('q') && b.sq[60] === (KING | BLACK) && b.sq[56] === (ROOK | BLACK)) c |= 8;
    b.castle = c;
    if (ep !== '-') {
      const e = parseSquare(ep);
      if (e === null) throw new Error('Invalid FEN: the en passant field is malformed.');
      // Keep only a consistent target: right rank, empty, with the pushed pawn in front.
      if (b.side === 0 && (e >> 3) === 5 && !b.sq[e] && !b.sq[e + 8] && b.sq[e - 8] === (PAWN | BLACK)) b.ep = e;
      else if (b.side === 1 && (e >> 3) === 2 && !b.sq[e] && !b.sq[e - 8] && b.sq[e + 8] === PAWN) b.ep = e;
    }
    if (!/^\d+$/.test(hm) || !/^\d+$/.test(fm)) throw new Error('Invalid FEN: the move counters must be non-negative integers.');
    b.halfmove = +hm; b.fullmove = Math.max(1, +fm);
    if (b.isAttacked(b.kings[b.side ^ 1], b.side)) throw new Error('Invalid FEN: the side not to move is in check.');
    b.computeHash();
    return b;
  }

  toFen() {
    let out = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.sq[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        const ch = TYPE_CHARS[p & 7];
        out += p & BLACK ? ch : ch.toUpperCase();
      }
      if (empty) out += empty;
      if (r) out += '/';
    }
    return `${out} ${this.side ? 'b' : 'w'} ${this.castlingString()} ${this.ep >= 0 ? squareName(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
  }

  castlingString() {
    const c = this.castle;
    const s = (c & 1 ? 'K' : '') + (c & 2 ? 'Q' : '') + (c & 4 ? 'k' : '') + (c & 8 ? 'q' : '');
    return s || '-';
  }

  // Is an en passant square relevant for hashing (an enemy pawn could capture)?
  _epHashable(e, capturer) {
    const pawn = PAWN | (capturer << 3);
    for (const s of PAWN_ATT[capturer ^ 1][e]) if (this.sq[s] === pawn) return true;
    return false;
  }

  computeHash() {
    let lo = 0, hi = 0;
    for (let s = 0; s < 64; s++) { const p = this.sq[s]; if (p) { lo ^= ZP_LO[p * 64 + s]; hi ^= ZP_HI[p * 64 + s]; } }
    lo ^= ZC_LO[this.castle]; hi ^= ZC_HI[this.castle];
    if (this.ep >= 0 && this._epHashable(this.ep, this.side)) { lo ^= ZE_LO[this.ep & 7]; hi ^= ZE_HI[this.ep & 7]; }
    if (this.side) { lo ^= ZS_LO; hi ^= ZS_HI; }
    this.hashLo = lo; this.hashHi = hi;
  }

  isAttacked(sq, by) {
    const s = this.sq, bb = by << 3;
    const pawn = PAWN | bb;
    const pa = PAWN_ATT[by ^ 1][sq];
    for (let i = 0; i < pa.length; i++) if (s[pa[i]] === pawn) return true;
    const kn = KNIGHT_T[sq], knight = KNIGHT | bb;
    for (let i = 0; i < kn.length; i++) if (s[kn[i]] === knight) return true;
    const kg = KING_T[sq], king = KING | bb;
    for (let i = 0; i < kg.length; i++) if (s[kg[i]] === king) return true;
    const rook = ROOK | bb, queen = QUEEN | bb, bishop = BISHOP | bb;
    for (let d = 0; d < 4; d++) {
      const ray = RAYS[d][sq];
      for (let i = 0; i < ray.length; i++) { const q = s[ray[i]]; if (q) { if (q === rook || q === queen) return true; break; } }
    }
    for (let d = 4; d < 8; d++) {
      const ray = RAYS[d][sq];
      for (let i = 0; i < ray.length; i++) { const q = s[ray[i]]; if (q) { if (q === bishop || q === queen) return true; break; } }
    }
    return false;
  }

  inCheck() { return this.isAttacked(this.kings[this.side], this.side ^ 1); }

  // Pseudo-legal moves pushed into `list` (array of ints). capturesOnly also
  // includes all promotions (useful for quiescence search).
  genPseudo(list, capturesOnly = false) {
    const s = this.sq, us = this.side, them = us ^ 1;
    for (let from = 0; from < 64; from++) {
      const p = s[from];
      if (!p || (p >> 3) !== us) continue;
      const t = p & 7;
      if (t === PAWN) {
        const fwd = us === 0 ? 8 : -8, to = from + fwd;
        const promoRank = us === 0 ? to >= 56 : to < 8;
        if (!s[to]) {
          if (promoRank) pushPromos(list, from, to, F_PROMO);
          else if (!capturesOnly) {
            list.push(from | (to << 6));
            const r = from >> 3;
            if ((us === 0 ? r === 1 : r === 6) && !s[to + fwd]) list.push(from | ((to + fwd) << 6) | (F_DOUBLE << 15));
          }
        }
        const pa = PAWN_ATT[us][from];
        for (let i = 0; i < pa.length; i++) {
          const c = pa[i], q = s[c];
          if (q && (q >> 3) === them) {
            if (promoRank) pushPromos(list, from, c, F_PROMO | F_CAPTURE);
            else list.push(from | (c << 6) | (F_CAPTURE << 15));
          } else if (c === this.ep) list.push(from | (c << 6) | ((F_EP | F_CAPTURE) << 15));
        }
      } else if (t === KNIGHT || t === KING) {
        const tbl = t === KNIGHT ? KNIGHT_T[from] : KING_T[from];
        for (let i = 0; i < tbl.length; i++) {
          const to = tbl[i], q = s[to];
          if (!q) { if (!capturesOnly) list.push(from | (to << 6)); }
          else if ((q >> 3) === them) list.push(from | (to << 6) | (F_CAPTURE << 15));
        }
        if (t === KING && !capturesOnly && this.castle) {
          if (us === 0 && from === 4) {
            if ((this.castle & 1) && !s[5] && !s[6] && s[7] === ROOK && !this.isAttacked(4, 1) && !this.isAttacked(5, 1)) list.push(4 | (6 << 6) | (F_KSIDE << 15));
            if ((this.castle & 2) && !s[3] && !s[2] && !s[1] && s[0] === ROOK && !this.isAttacked(4, 1) && !this.isAttacked(3, 1)) list.push(4 | (2 << 6) | (F_QSIDE << 15));
          } else if (us === 1 && from === 60) {
            if ((this.castle & 4) && !s[61] && !s[62] && s[63] === (ROOK | BLACK) && !this.isAttacked(60, 0) && !this.isAttacked(61, 0)) list.push(60 | (62 << 6) | (F_KSIDE << 15));
            if ((this.castle & 8) && !s[59] && !s[58] && !s[57] && s[56] === (ROOK | BLACK) && !this.isAttacked(60, 0) && !this.isAttacked(59, 0)) list.push(60 | (58 << 6) | (F_QSIDE << 15));
          }
        }
      } else {
        const d0 = t === BISHOP ? 4 : 0, d1 = t === ROOK ? 4 : 8;
        for (let d = d0; d < d1; d++) {
          const ray = RAYS[d][from];
          for (let i = 0; i < ray.length; i++) {
            const to = ray[i], q = s[to];
            if (!q) { if (!capturesOnly) list.push(from | (to << 6)); continue; }
            if ((q >> 3) === them) list.push(from | (to << 6) | (F_CAPTURE << 15));
            break;
          }
        }
      }
    }
    return list;
  }

  // Legal moves as encoded ints.
  legalCodes(capturesOnly = false) {
    const pl = this.genPseudo([], capturesOnly), out = [], us = this.side;
    for (let i = 0; i < pl.length; i++) {
      const m = pl[i];
      this.make(m);
      if (!this.isAttacked(this.kings[us], us ^ 1)) out.push(m);
      this.unmake(m);
    }
    return out;
  }

  // Is the (pseudo-legal) move legal? Uses make/unmake.
  isLegal(m) {
    const us = this.side; this.make(m);
    const ok = !this.isAttacked(this.kings[us], us ^ 1);
    this.unmake(m); return ok;
  }

  make(m) {
    const s = this.sq, us = this.side, them = us ^ 1;
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7, fl = m >>> 15;
    const p = s[from];
    const capSq = fl & F_EP ? (us === 0 ? to - 8 : to + 8) : to;
    const cap = s[capSq];
    this._stack.push(cap, this.castle, this.ep, this.halfmove, this.hashLo, this.hashHi);
    let lo = this.hashLo, hi = this.hashHi;
    if (this.ep >= 0 && this._epHashable(this.ep, us)) { lo ^= ZE_LO[this.ep & 7]; hi ^= ZE_HI[this.ep & 7]; }
    lo ^= ZP_LO[p * 64 + from]; hi ^= ZP_HI[p * 64 + from];
    if (cap) { lo ^= ZP_LO[cap * 64 + capSq]; hi ^= ZP_HI[cap * 64 + capSq]; s[capSq] = 0; }
    const np = promo ? (promo | (us << 3)) : p;
    s[from] = 0; s[to] = np;
    lo ^= ZP_LO[np * 64 + to]; hi ^= ZP_HI[np * 64 + to];
    if (fl & (F_KSIDE | F_QSIDE)) {
      const rf = fl & F_KSIDE ? to + 1 : to - 2, rt = fl & F_KSIDE ? to - 1 : to + 1;
      const rk = s[rf]; s[rf] = 0; s[rt] = rk;
      lo ^= ZP_LO[rk * 64 + rf] ^ ZP_LO[rk * 64 + rt]; hi ^= ZP_HI[rk * 64 + rf] ^ ZP_HI[rk * 64 + rt];
    }
    if ((p & 7) === KING) this.kings[us] = to;
    const nc = this.castle & CASTLE_MASK[from] & CASTLE_MASK[to];
    if (nc !== this.castle) { lo ^= ZC_LO[this.castle] ^ ZC_LO[nc]; hi ^= ZC_HI[this.castle] ^ ZC_HI[nc]; this.castle = nc; }
    this.ep = -1;
    if (fl & F_DOUBLE) {
      const e = (from + to) >> 1; this.ep = e;
      if (this._epHashable(e, them)) { lo ^= ZE_LO[e & 7]; hi ^= ZE_HI[e & 7]; }
    }
    this.halfmove = ((p & 7) === PAWN || cap) ? 0 : this.halfmove + 1;
    if (us === 1) this.fullmove++;
    this.side = them;
    this.hashLo = lo ^ ZS_LO; this.hashHi = hi ^ ZS_HI;
  }

  unmake(m) {
    const s = this.sq, st = this._stack;
    this.hashHi = st.pop(); this.hashLo = st.pop(); this.halfmove = st.pop(); this.ep = st.pop(); this.castle = st.pop();
    const cap = st.pop();
    this.side ^= 1;
    const us = this.side;
    if (us === 1) this.fullmove--;
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7, fl = m >>> 15;
    const np = s[to];
    const p = promo ? (PAWN | (us << 3)) : np;
    s[from] = p;
    if (fl & F_EP) { s[to] = 0; s[us === 0 ? to - 8 : to + 8] = cap; } else s[to] = cap;
    if (fl & (F_KSIDE | F_QSIDE)) {
      const rf = fl & F_KSIDE ? to + 1 : to - 2, rt = fl & F_KSIDE ? to - 1 : to + 1;
      s[rf] = s[rt]; s[rt] = 0;
    }
    if ((p & 7) === KING) this.kings[us] = from;
  }

  // Null move for search (side to move passes). Not legal chess.
  makeNull() {
    this._stack.push(0, this.castle, this.ep, this.halfmove, this.hashLo, this.hashHi);
    let lo = this.hashLo, hi = this.hashHi;
    if (this.ep >= 0 && this._epHashable(this.ep, this.side)) { lo ^= ZE_LO[this.ep & 7]; hi ^= ZE_HI[this.ep & 7]; }
    this.ep = -1; this.halfmove++; this.side ^= 1;
    this.hashLo = lo ^ ZS_LO; this.hashHi = hi ^ ZS_HI;
  }
  unmakeNull() {
    const st = this._stack;
    this.hashHi = st.pop(); this.hashLo = st.pop(); this.halfmove = st.pop(); this.ep = st.pop(); this.castle = st.pop(); st.pop();
    this.side ^= 1;
  }

  // 52-bit-ish numeric key and string key helpers for transposition tables.
  get zobrist() { return (this.hashHi >>> 0) * 4294967296 + (this.hashLo >>> 0); }
}

function pushPromos(list, from, to, fl) {
  const base = from | (to << 6) | (fl << 15);
  list.push(base | (QUEEN << 12), base | (ROOK << 12), base | (BISHOP << 12), base | (KNIGHT << 12));
}

function perftBoard(b, depth) {
  if (depth === 0) return 1;
  const moves = b.legalCodes();
  if (depth === 1) return moves.length;
  let n = 0;
  for (let i = 0; i < moves.length; i++) { b.make(moves[i]); n += perftBoard(b, depth - 1); b.unmake(moves[i]); }
  return n;
}

export function perft(position, depth) {
  const b = position instanceof Board ? position.clone() : (typeof position === 'string' ? Board.fromFen(position) : position._b.clone());
  return perftBoard(b, depth);
}

export function perftDivide(position, depth) {
  const b = position instanceof Board ? position.clone() : (typeof position === 'string' ? Board.fromFen(position) : position._b.clone());
  const out = {};
  for (const m of b.legalCodes()) { b.make(m); out[codeToUci(m)] = depth > 1 ? perftBoard(b, depth - 1) : 1; b.unmake(m); }
  return out;
}

export function codeToUci(m) {
  const pr = (m >> 12) & 7;
  return squareName(m & 63) + squareName((m >> 6) & 63) + (pr ? TYPE_CHARS[pr] : '');
}

export function moveToUci(move) {
  if (typeof move === 'number') return codeToUci(move);
  return squareName(move.from) + squareName(move.to) + (move.promotion || '');
}

// =====================================================================
// Position: immutable public wrapper.
// =====================================================================
export class Position {
  constructor(board) {
    this._b = board || Board.fromFen(START_FEN);
    this._legal = null; this._boardArr = null; this._hash = null; this._castling = null;
  }
  static fromFen(fen) { return new Position(Board.fromFen(fen)); }
  static fromBoard(board) { const b = board.clone(); return new Position(b); }
  toFen() { return this._b.toFen(); }
  /** A fresh mutable Board copy, for search. */
  toBoard() { return this._b.clone(); }

  get turn() { return this._b.side ? 'b' : 'w'; }
  get board() {
    if (!this._boardArr) {
      const a = new Array(64), s = this._b.sq;
      for (let i = 0; i < 64; i++) a[i] = PIECE_OBJ[s[i]];
      this._boardArr = Object.freeze(a);
    }
    return this._boardArr;
  }
  get castling() {
    if (!this._castling) { const c = this._b.castle; this._castling = Object.freeze({ wK: !!(c & 1), wQ: !!(c & 2), bK: !!(c & 4), bQ: !!(c & 8) }); }
    return this._castling;
  }
  get epSquare() { return this._b.ep >= 0 ? this._b.ep : null; }
  get halfmove() { return this._b.halfmove; }
  get fullmove() { return this._b.fullmove; }
  get zobrist() { return this._b.zobrist; }

  pieceAt(sq) { return PIECE_OBJ[this._b.sq[sq]]; }
  kingSquare(color) { return this._b.kings[color === 'b' ? 1 : 0]; }
  isAttacked(sq, byColor) { return this._b.isAttacked(sq, byColor === 'b' ? 1 : 0); }

  legalCodes() { return this._legal || (this._legal = this._b.legalCodes()); }
  codeToMove(m) {
    const s = this._b.sq, from = m & 63, to = (m >> 6) & 63, pr = (m >> 12) & 7, fl = m >>> 15;
    const p = s[from];
    let captured = null;
    if (fl & F_EP) captured = 'p'; else if (s[to]) captured = TYPE_CHARS[s[to] & 7];
    let flags = '';
    if (fl & F_CAPTURE) flags += 'c';
    if (fl & F_EP) flags += 'e';
    if (fl & F_KSIDE) flags += 'k';
    if (fl & F_QSIDE) flags += 'q';
    if (fl & F_PROMO) flags += 'p';
    if (fl & F_DOUBLE) flags += 'd';
    const mv = { from, to, piece: TYPE_CHARS[p & 7], color: p & BLACK ? 'b' : 'w', captured, flags };
    if (pr) mv.promotion = TYPE_CHARS[pr];
    return mv;
  }
  legalMoves() { return this.legalCodes().map((m) => this.codeToMove(m)); }
  legalMovesFrom(sq) { return this.legalCodes().filter((m) => (m & 63) === sq).map((m) => this.codeToMove(m)); }

  /** Resolve a move object, UCI/SAN string or code to a legal code, or -1. */
  moveCode(move) {
    const codes = this.legalCodes();
    if (typeof move === 'number') return codes.includes(move) ? move : -1;
    if (typeof move === 'string') {
      const mv = this.parseUci(move) || this.parseSan(move);
      return mv ? this.moveCode(mv) : -1;
    }
    if (!move || typeof move !== 'object') return -1;
    const from = typeof move.from === 'string' ? parseSquare(move.from) : move.from;
    const to = typeof move.to === 'string' ? parseSquare(move.to) : move.to;
    const pr = move.promotion ? TYPE_INDEX[String(move.promotion).toLowerCase()] || -1 : 0;
    let fallback = -1;
    for (const m of codes) {
      if ((m & 63) !== from || ((m >> 6) & 63) !== to) continue;
      const mp = (m >> 12) & 7;
      if (mp === pr) return m;
      if (!pr && mp === QUEEN) fallback = m; // promotion omitted: default to queen
    }
    return fallback;
  }
  isLegal(move) { return this.moveCode(move) !== -1; }

  makeMove(move) {
    const m = this.moveCode(move);
    if (m === -1) throw new Error(`Illegal move: ${typeof move === 'object' ? JSON.stringify(move) : move}`);
    const nb = this._b.clone();
    nb.make(m); nb._stack.length = 0;
    return new Position(nb);
  }

  inCheck() { return this._b.inCheck(); }
  isCheck() { return this.inCheck(); }
  isCheckmate() { return this.legalCodes().length === 0 && this.inCheck(); }
  isStalemate() { return this.legalCodes().length === 0 && !this.inCheck(); }
  isFiftyMoveDraw() { return this._b.halfmove >= 100 && !this.isCheckmate(); }
  isInsufficientMaterial() {
    const s = this._b.sq; let minors = 0, knights = 0, bishopColors = 0;
    for (let i = 0; i < 64; i++) {
      const t = s[i] & 7;
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === KNIGHT) knights++; else bishopColors |= ((i & 7) + (i >> 3)) & 1 ? 1 : 2;
    }
    if (minors <= 1) return true;
    return knights === 0 && bishopColors !== 3;
  }
  isGameOver() { return this.legalCodes().length === 0 || this.isInsufficientMaterial() || this.isFiftyMoveDraw(); }

  hash() {
    if (this._hash === null) {
      const f = this.toFen().split(' ');
      const epLegal = this.legalCodes().some((m) => (m >>> 15) & F_EP);
      this._hash = `${f[0]} ${f[1]} ${f[2]} ${epLegal ? f[3] : '-'}`;
    }
    return this._hash;
  }

  // ---- SAN ----
  _sanCore(m) {
    const s = this._b.sq, from = m & 63, to = (m >> 6) & 63, pr = (m >> 12) & 7, fl = m >>> 15;
    if (fl & F_KSIDE) return 'O-O';
    if (fl & F_QSIDE) return 'O-O-O';
    const t = s[from] & 7;
    let san = '';
    if (t === PAWN) {
      if (fl & F_CAPTURE) san = FILES[from & 7] + 'x';
      san += squareName(to);
      if (pr) san += '=' + TYPE_CHARS[pr].toUpperCase();
      return san;
    }
    san = TYPE_CHARS[t].toUpperCase();
    if (t !== KING) {
      let ambig = false, sameFile = false, sameRank = false;
      for (const o of this.legalCodes()) {
        const of = o & 63;
        if (((o >> 6) & 63) !== to || of === from || (s[of] & 7) !== t) continue;
        ambig = true;
        if ((of & 7) === (from & 7)) sameFile = true;
        if ((of >> 3) === (from >> 3)) sameRank = true;
      }
      if (ambig) san += !sameFile ? FILES[from & 7] : !sameRank ? String((from >> 3) + 1) : squareName(from);
    }
    if (fl & F_CAPTURE) san += 'x';
    return san + squareName(to);
  }
  toSan(move) {
    const m = this.moveCode(move);
    if (m === -1) throw new Error(`Illegal move: ${typeof move === 'object' ? JSON.stringify(move) : move}`);
    let san = this._sanCore(m);
    const b = this._b; b.make(m);
    if (b.inCheck()) san += b.legalCodes().length ? '+' : '#';
    b.unmake(m);
    return san;
  }
  parseSan(san) {
    if (typeof san !== 'string') return null;
    let t = san.trim().replace(/e\.p\.$/i, '').replace(/[+#!?]+$/, '').replace(/[+#]/g, '').trim();
    if (!t) return null;
    if (/^[0O]-[0O]$/.test(t)) t = 'O-O';
    if (/^[0O]-[0O]-[0O]$/.test(t)) t = 'O-O-O';
    const codes = this.legalCodes();
    for (const m of codes) if (this._sanCore(m) === t) return this.codeToMove(m);
    if (t === 'O-O' || t === 'O-O-O') return null;
    const r = /^([NBRQK])?([a-h])?([1-8])?[x:]?-?([a-h][1-8])(?:=?\(?([NBRQnbrq])\)?)?$/.exec(t);
    if (!r) return null;
    const type = r[1] ? TYPE_INDEX[r[1].toLowerCase()] : PAWN;
    const ff = r[2] ? r[2].charCodeAt(0) - 97 : -1, fr = r[3] ? +r[3] - 1 : -1;
    const to = parseSquare(r[4]);
    const pr = r[5] ? TYPE_INDEX[r[5].toLowerCase()] : 0;
    const s = this._b.sq;
    const cands = codes.filter((m) => {
      const f = m & 63;
      if (((m >> 6) & 63) !== to || (s[f] & 7) !== type) return false;
      if (ff >= 0 && (f & 7) !== ff) return false;
      if (fr >= 0 && (f >> 3) !== fr) return false;
      const mp = (m >> 12) & 7;
      return pr ? mp === pr : (mp === 0 || mp === QUEEN);
    });
    return cands.length === 1 ? this.codeToMove(cands[0]) : null;
  }

  // ---- UCI ----
  parseUci(uci) {
    if (typeof uci !== 'string') return null;
    const r = /^([a-h][1-8])([a-h][1-8])([qrbnQRBN])?$/.exec(uci.trim());
    if (!r) return null;
    const from = parseSquare(r[1]); let to = parseSquare(r[2]);
    const pr = r[3] ? TYPE_INDEX[r[3].toLowerCase()] : 0;
    const codes = this.legalCodes();
    // Accept king-takes-own-rook castling notation (e1h1, e1a1).
    const p = this._b.sq[from];
    if ((p & 7) === KING && this._b.sq[to] === (ROOK | (p & BLACK))) {
      if (to === from + 3) to = from + 2; else if (to === from - 4) to = from - 2;
    }
    for (const m of codes) if ((m & 63) === from && ((m >> 6) & 63) === to && ((m >> 12) & 7) === pr) return this.codeToMove(m);
    return null;
  }
  moveToUci(move) { return moveToUci(move); }
}

// =====================================================================
// Game: history, results, PGN and JSON.
// =====================================================================
const RESULT_TOKENS = ['1-0', '0-1', '1/2-1/2', '*'];
const STR_ORDER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

export class Game {
  constructor(startFen = START_FEN) {
    const start = startFen instanceof Position ? startFen : Position.fromFen(startFen);
    this.startFen = start.toFen();
    this._posLine = [start];
    this._line = [];
    this._sanLine = [];
    this._ply = 0;
    this._resultInfo = null; // {result, reason, ply}
    this.headers = {};
    this.comments = {};      // ply -> text (comment after the move that reached that ply; 0 = before first move)
    this.nags = {};          // ply -> [numbers]
  }

  get position() { return this._posLine[this._ply]; }
  get moves() { return this._line.slice(0, this._ply); }
  get sans() { return this._sanLine.slice(0, this._ply); }
  get positions() { return this._posLine.slice(0, this._ply + 1); }
  /** Whole main line, including moves beyond the cursor (redo stack). */
  get line() { return this._line.slice(); }
  get lineSans() { return this._sanLine.slice(); }
  get linePositions() { return this._posLine.slice(); }
  get ply() { return this._ply; }
  get length() { return this._line.length; }
  get turn() { return this.position.turn; }
  get lastMove() { return this._ply ? this._line[this._ply - 1] : null; }
  get resultInfo() { return this._resultInfo ? { ...this._resultInfo } : null; }
  fen() { return this.position.toFen(); }
  canUndo() { return this._ply > 0; }
  canRedo() { return this._ply < this._line.length; }

  play(move) {
    if (this.result()) return false;
    const pos = this.position;
    const code = pos.moveCode(move);
    if (code === -1) return false;
    const mv = pos.codeToMove(code);
    const san = pos.toSan(code);
    const next = pos.makeMove(code);
    const p = this._ply;
    if (p < this._line.length) {
      this._line.length = p; this._sanLine.length = p; this._posLine.length = p + 1;
      for (const k of Object.keys(this.comments)) if (+k > p) delete this.comments[k];
      for (const k of Object.keys(this.nags)) if (+k > p) delete this.nags[k];
      if (this._resultInfo && this._resultInfo.ply > p) this._resultInfo = null;
    }
    this._line.push(mv); this._sanLine.push(san); this._posLine.push(next);
    this._ply++;
    return true;
  }
  playSan(san) { const m = this.position.parseSan(san); return m ? this.play(m) : false; }
  playUci(uci) { const m = this.position.parseUci(uci); return m ? this.play(m) : false; }

  undo() { if (this._ply === 0) return false; this._ply--; return true; }
  redo() { if (this._ply >= this._line.length) return false; this._ply++; return true; }
  goto(plyIndex) {
    const n = Math.max(0, Math.min(this._line.length, Math.trunc(Number(plyIndex) || 0)));
    const changed = n !== this._ply; this._ply = n; return changed;
  }

  _resultAt(ply) {
    const ri = this._resultInfo;
    if (ri && ri.ply === ply) return { result: ri.result, reason: ri.reason };
    const p = this._posLine[ply];
    if (p.isCheckmate()) return { result: p.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
    if (p.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
    if (p.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient' };
    const h = p.hash(); let count = 0;
    for (let i = ply; i >= 0 && count < 3; i--) if (this._posLine[i].hash() === h) count++;
    if (count >= 3) return { result: '1/2-1/2', reason: 'threefold' };
    if (p.halfmove >= 100) return { result: '1/2-1/2', reason: 'fifty-move' };
    return null;
  }
  result() { return this._resultAt(this._ply); }
  isGameOver() { return this.result() !== null; }
  /** Number of times the current position has occurred so far (for UI). */
  repetitionCount() {
    const h = this.position.hash(); let c = 0;
    for (let i = 0; i <= this._ply; i++) if (this._posLine[i].hash() === h) c++;
    return c;
  }

  _setResult(result, reason) {
    if (this.result()) return false;
    // A result fixes the game at this ply; later moves are discarded.
    if (this._ply < this._line.length) {
      const p = this._ply;
      this._line.length = p; this._sanLine.length = p; this._posLine.length = p + 1;
    }
    this._resultInfo = { result, reason, ply: this._ply };
    return true;
  }
  resign(color = this.turn) { return this._setResult(color === 'w' ? '0-1' : '1-0', 'resignation'); }
  drawByAgreement() { return this._setResult('1/2-1/2', 'agreement'); }
  timeout(color = this.turn) {
    const winner = color === 'w' ? 'b' : 'w';
    const pos = this.position;
    let winnerHasMaterial = false;
    for (const pc of pos.board) if (pc && pc.color === winner && pc.type !== 'k') { winnerHasMaterial = true; break; }
    if (!winnerHasMaterial || pos.isInsufficientMaterial()) return this._setResult('1/2-1/2', 'timeout');
    return this._setResult(winner === 'w' ? '1-0' : '0-1', 'timeout');
  }

  // ---- PGN ----
  toPgn(headers = {}) {
    const end = this._line.length;
    const res = this._resultAt(end);
    const resultTok = res ? res.result : '*';
    const h = { Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?', ...this.headers, ...headers, Result: resultTok };
    if (this.startFen !== START_FEN) { h.SetUp = '1'; h.FEN = this.startFen; } else { delete h.SetUp; delete h.FEN; }
    const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
    const keys = [...STR_ORDER, ...Object.keys(h).filter((k) => !STR_ORDER.includes(k))];
    let out = keys.filter((k) => h[k] !== undefined && h[k] !== null).map((k) => `[${k} "${esc(h[k])}"]`).join('\n') + '\n\n';
    const toks = [];
    const cmt = (t) => `{${String(t).replace(/[{}]/g, '')}}`;
    if (this.comments[0]) toks.push(cmt(this.comments[0]));
    let needNum = true;
    for (let i = 0; i < end; i++) {
      const p = this._posLine[i];
      if (p.turn === 'w') toks.push(`${p.fullmove}.`);
      else if (needNum) toks.push(`${p.fullmove}...`);
      needNum = false;
      toks.push(this._sanLine[i]);
      const ng = this.nags[i + 1];
      if (ng) for (const n of ng) toks.push(`$${n}`);
      if (this.comments[i + 1]) { toks.push(cmt(this.comments[i + 1])); needNum = true; }
    }
    toks.push(resultTok);
    let line = '';
    const lines = [];
    for (const t of toks) {
      if (line && line.length + 1 + t.length > 80) { lines.push(line); line = t; } else line = line ? line + ' ' + t : t;
    }
    if (line) lines.push(line);
    return out + lines.join('\n') + '\n';
  }

  static fromPgn(text) {
    const parsed = parsePgn(text);
    const h = parsed.headers;
    if (h.Variant && !/^(standard|chess)$/i.test(h.Variant)) throw new Error(`Unsupported PGN variant "${h.Variant}".`);
    const g = new Game(h.FEN || START_FEN);
    g.headers = { ...h };
    delete g.headers.FEN; delete g.headers.SetUp; delete g.headers.Result;
    for (const item of parsed.items) {
      if (item.type === 'comment') { g.comments[g._ply] = g.comments[g._ply] ? g.comments[g._ply] + ' ' + item.text : item.text; continue; }
      if (item.type === 'nag') { (g.nags[g._ply] ||= []).push(item.nag); continue; }
      const mv = g.position.parseSan(item.san);
      if (!mv || !g.play(mv)) throw new Error(`Illegal or unreadable move "${item.san}" at move ${g.position.fullmove} (${g.turn === 'w' ? 'White' : 'Black'} to move).`);
    }
    const token = parsed.result || h.Result;
    if (!g.result() && token && token !== '*' && RESULT_TOKENS.includes(token)) {
      const term = String(h.Termination || '').toLowerCase();
      const timeish = term.includes('time') || term.includes('forfeit');
      g._resultInfo = { result: token, reason: timeish ? 'timeout' : token === '1/2-1/2' ? 'agreement' : 'resignation', ply: g._ply };
    }
    return g;
  }

  // ---- JSON ----
  toJSON() {
    const o = { version: 1, startFen: this.startFen, uci: this._line.map(moveToUci), resultInfo: this._resultInfo ? { ...this._resultInfo } : null };
    if (this._ply !== this._line.length) o.ply = this._ply;
    if (Object.keys(this.headers).length) o.headers = { ...this.headers };
    if (Object.keys(this.comments).length) o.comments = { ...this.comments };
    if (Object.keys(this.nags).length) o.nags = Object.fromEntries(Object.entries(this.nags).map(([k, v]) => [k, v.slice()]));
    return o;
  }
  static fromJSON(obj) {
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { throw new Error('The saved game is not valid JSON.'); } }
    if (!obj || typeof obj !== 'object') throw new Error('The saved game data is missing.');
    if (obj.version !== 1) throw new Error(`Unsupported saved game version: ${obj.version}.`);
    if (!Array.isArray(obj.uci)) throw new Error('The saved game has no move list.');
    let g;
    try { g = new Game(obj.startFen || START_FEN); } catch (e) { throw new Error(`The saved game has an invalid start position. ${e.message}`); }
    obj.uci.forEach((u, i) => {
      const mv = g.position.parseUci(String(u));
      if (!mv || !g.play(mv)) throw new Error(`The saved game contains an illegal move "${u}" at ply ${i + 1}.`);
    });
    const ri = obj.resultInfo;
    if (ri) {
      if (!RESULT_TOKENS.includes(ri.result) || typeof ri.reason !== 'string') throw new Error('The saved game has an invalid result.');
      const ply = Number.isInteger(ri.ply) ? ri.ply : g._line.length;
      if (ply < 0 || ply > g._line.length) throw new Error('The saved game result refers to a move that does not exist.');
      g._resultInfo = { result: ri.result, reason: ri.reason, ply };
    }
    if (obj.headers && typeof obj.headers === 'object') g.headers = { ...obj.headers };
    if (obj.comments && typeof obj.comments === 'object') g.comments = { ...obj.comments };
    if (obj.nags && typeof obj.nags === 'object') g.nags = Object.fromEntries(Object.entries(obj.nags).map(([k, v]) => [k, Array.from(v, Number)]));
    if (obj.ply !== undefined) g.goto(obj.ply);
    return g;
  }
}

// ---- PGN parsing helpers ----
export function splitPgnGames(text) {
  const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const games = []; let cur = []; let inMoves = false;
  for (const line of src.split('\n')) {
    const isHeader = /^\s*\[\w+\s+".*"\s*\]\s*$/.test(line);
    if (isHeader && inMoves) { games.push(cur.join('\n')); cur = []; inMoves = false; }
    if (!isHeader && line.trim()) inMoves = true;
    cur.push(line);
  }
  if (cur.join('').trim()) games.push(cur.join('\n'));
  return games;
}

export function parsePgn(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The PGN text is empty.');
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const headers = {};
  let i = 0;
  const lines = src.split('\n');
  let body = [];
  let inHeaders = true;
  for (const line of lines) {
    if (/^%/.test(line)) continue; // escape mechanism
    const m = inHeaders && /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/.exec(line);
    if (m) { headers[m[1]] = m[2].replace(/\\(.)/g, '$1'); continue; }
    if (line.trim()) inHeaders = false;
    if (!inHeaders) {
      if (/^\s*\[\w+\s+".*"\s*\]\s*$/.test(line)) break; // next game starts
      body.push(line);
    }
  }
  const mt = body.join('\n').replace(/e\.p\./g, '');
  const re = /\{([^}]*)\}|;([^\n]*)|(\()|(\))|\$(\d+)|(1-0|0-1|1\/2-1\/2|\*)|(\d+\.+)|(\.\.\.)|([^\s{}();$]+)/g;
  const items = []; let depth = 0; let result = null; let m;
  while ((m = re.exec(mt))) {
    i++;
    if (m[3]) { depth++; continue; }
    if (m[4]) { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue;
    if (m[1] !== undefined) { const t = m[1].trim().replace(/\s+/g, ' '); if (t) items.push({ type: 'comment', text: t }); continue; }
    if (m[2] !== undefined) { const t = m[2].trim(); if (t) items.push({ type: 'comment', text: t }); continue; }
    if (m[5]) { items.push({ type: 'nag', nag: +m[5] }); continue; }
    if (m[6]) { result = m[6]; continue; }
    if (m[7] || m[8]) continue;
    let tok = m[9];
    const nagSym = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
    if (nagSym[tok]) { items.push({ type: 'nag', nag: nagSym[tok] }); continue; }
    if (/^[!?+\-=∞]+$/.test(tok)) continue;
    const suf = /([!?]{1,2})$/.exec(tok);
    tok = tok.replace(/[!?]+$/, '');
    items.push({ type: 'move', san: tok });
    if (suf && nagSym[suf[1]]) items.push({ type: 'nag', nag: nagSym[suf[1]] });
  }
  return { headers, items, result };
}
