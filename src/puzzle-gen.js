/**
 * Ornate Chess — procedural tactics puzzle generator.
 * Pure ES module (no DOM), importable in Node and in a Web Worker.
 *
 * How it works:
 * 1. A seeded random generator picks a named opening line from the opening
 *    dataset and plays it, then continues with semi-random but plausible moves
 *    chosen by a shallow material search with noise. Some moves are "natural
 *    mistakes": moves that look safe one move deep but lose to a tactic.
 * 2. After every move, the position is scanned with a fixed-depth alpha-beta
 *    search (material evaluation, quiescence, mate scores). A position becomes
 *    a candidate when the side to move has a move that forces mate or wins at
 *    least a minor piece's worth of material compared with the position before
 *    the opponent's last move (so plain recaptures do not count).
 * 3. The solution line is built move by move. At every solver step the best
 *    move must be unique: every other move is re-searched with a null window
 *    and must score clearly worse. Opponent replies are the engine's best
 *    defence. The line ends at checkmate or once the material is won.
 * 4. The puzzle is classified by theme (mate in N, fork, pin, skewer,
 *    discovered attack, hanging piece, sacrifice, promotion) and by the
 *    shallowest search depth that finds it, which sets the difficulty.
 * All searches are depth- and node-limited, never time-limited, so a seed
 * always reproduces the same puzzle.
 */
import { Board, Position, START_FEN, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, F_CAPTURE, F_EP, F_PROMO, codeToUci } from './engine.js';
import { OPENINGS } from './openings.js';
import { verifyWithEngine } from './puzzle-verify.js';

const VAL = [0, 100, 320, 330, 500, 900, 0];
const MATE = 100000;
const MATE_BOUND = 90000;
const INF = 1000000;
const TT_SIZE = 1 << 16;
const TT_MASK = TT_SIZE - 1;

export const LEVELS = {
  easy: { id: 'easy', name: 'Easy', depth: 3, maxSteps: 2, maxMate: 1, minDiscover: 1, maxDiscover: 2, rating: 900 },
  medium: { id: 'medium', name: 'Medium', depth: 4, maxSteps: 4, maxMate: 3, minDiscover: 2, maxDiscover: 4, rating: 1350 },
  hard: { id: 'hard', name: 'Hard', depth: 4, maxSteps: 4, maxMate: 3, minDiscover: 2, maxDiscover: 9, rating: 1800 },
};

// ---------------------------------------------------------------------------
// Seeded random numbers
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mixSeed(seed, i) {
  let h = (seed ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
export function randomSeed() { return (Math.random() * 4294967296) >>> 0; }

// ---------------------------------------------------------------------------
// Material search
// ---------------------------------------------------------------------------
/** Material balance from the side to move's point of view. */
export function material(b) {
  const s = b.sq;
  let w = 0;
  for (let i = 0; i < 64; i++) { const p = s[i]; if (p) w += p & 8 ? -VAL[p & 7] : VAL[p & 7]; }
  return b.side ? -w : w;
}

class Searcher {
  constructor(nodeLimit = 400000) {
    this.tt = null; // allocated on first use, see ttInit()
    this.nodes = 0;
    this.nodeLimit = nodeLimit;
    this.aborted = false;
    this.killers = [];
  }
  // Transposition table in typed arrays: one slot per index, always replaced.
  ttInit() {
    this.tt = { lo: new Int32Array(TT_SIZE), hi: new Int32Array(TT_SIZE), depth: new Int8Array(TT_SIZE).fill(-1), flag: new Int8Array(TT_SIZE), score: new Int32Array(TT_SIZE), move: new Int32Array(TT_SIZE) };
  }
  ttGet(b) {
    const t = this.tt;
    if (!t) return null;
    const i = b.hashLo & TT_MASK;
    if (t.depth[i] < 0 || t.lo[i] !== (b.hashLo | 0) || t.hi[i] !== (b.hashHi | 0)) return null;
    return { depth: t.depth[i], score: t.score[i], flag: t.flag[i], move: t.move[i] };
  }
  ttSet(b, depth, score, flag, move) {
    if (!this.tt) this.ttInit();
    const t = this.tt, i = b.hashLo & TT_MASK;
    t.lo[i] = b.hashLo | 0; t.hi[i] = b.hashHi | 0; t.depth[i] = Math.min(depth, 100); t.score[i] = score; t.flag[i] = flag; t.move[i] = move;
  }
  key(b) { return `${b.hashHi >>> 0}:${b.hashLo >>> 0}`; }
  order(b, moves, ttMove, ply) {
    const k = this.killers[ply] || 0;
    const n = moves.length;
    const sc = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      let s = 0;
      if (m === ttMove) s = 10000000;
      else {
        const fl = m >>> 15;
        if (fl & F_EP) s = 1000000 + 100 * 16 - 100;
        else if (fl & F_CAPTURE) s = 1000000 + VAL[b.sq[(m >> 6) & 63] & 7] * 16 - VAL[b.sq[m & 63] & 7];
        if (fl & F_PROMO) s += 900000 + VAL[(m >> 12) & 7];
        if (!s && m === k) s = 500000;
      }
      sc[i] = s;
    }
    // Stable insertion sort (the lists are short), same order as a stable sort by score.
    const out = moves.slice();
    for (let i = 1; i < n; i++) {
      const m = out[i], v = sc[i];
      let j = i - 1;
      while (j >= 0 && sc[j] < v) { sc[j + 1] = sc[j]; out[j + 1] = out[j]; j--; }
      sc[j + 1] = v; out[j + 1] = m;
    }
    return out;
  }
  quiesce(b, alpha, beta, ply, qply) {
    this.nodes++;
    if (this.nodes > this.nodeLimit) { this.aborted = true; return alpha; }
    const us = b.side;
    // Checks are answered with every evasion so that checking lines are judged
    // correctly; very long checking sequences are cut off at a fixed length.
    const inCheck = b.inCheck();
    if (inCheck && qply >= 6) return material(b);
    if (inCheck) {
      let legal = 0;
      for (const m of this.order(b, b.genPseudo([]), 0, ply)) {
        b.make(m);
        if (b.isAttacked(b.kings[us], us ^ 1)) { b.unmake(m); continue; }
        legal++;
        const v = -this.quiesce(b, -beta, -alpha, ply + 1, qply + 1);
        b.unmake(m);
        if (v >= beta) return v;
        if (v > alpha) alpha = v;
      }
      return legal ? alpha : -MATE + ply;
    }
    const stand = material(b);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of this.order(b, b.genPseudo([], true), 0, ply)) {
      b.make(m);
      if (b.isAttacked(b.kings[us], us ^ 1)) { b.unmake(m); continue; }
      const v = -this.quiesce(b, -beta, -alpha, ply + 1, qply + 1);
      b.unmake(m);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
      if (this.aborted) break;
    }
    return alpha;
  }
  search(b, depth, alpha, beta, ply) {
    if (this.aborted) return alpha;
    const inCheck = b.inCheck();
    if (inCheck && ply < 12) depth++;
    if (depth <= 0) return this.quiesce(b, alpha, beta, ply, 0);
    this.nodes++;
    if (this.nodes > this.nodeLimit) { this.aborted = true; return alpha; }
    if (ply > 0 && b.halfmove >= 100) return 0;
    const e = this.ttGet(b);
    let ttMove = 0;
    if (e) {
      ttMove = e.move;
      if (e.depth >= depth && ply > 0) {
        const sc = e.score > MATE_BOUND ? e.score - ply : e.score < -MATE_BOUND ? e.score + ply : e.score;
        if (e.flag === 0) return sc;
        if (e.flag === 1 && sc <= alpha) return sc;
        if (e.flag === 2 && sc >= beta) return sc;
      }
    }
    const us = b.side;
    const a0 = alpha;
    let best = -INF, bestMove = 0, legal = 0;
    // Exact frontier pruning: with one ply left and no check, a quiet move that
    // gives no check cannot score above the current material, because the
    // opponent may stand pat in the capture search.
    const stat = depth === 1 && !inCheck ? material(b) : 0;
    const prune = depth === 1 && !inCheck && stat <= alpha;
    for (const m of this.order(b, b.genPseudo([]), ttMove, ply)) {
      b.make(m);
      if (b.isAttacked(b.kings[us], us ^ 1)) { b.unmake(m); continue; }
      legal++;
      if (prune && !((m >>> 15) & (F_CAPTURE | F_EP | F_PROMO)) && !b.inCheck()) {
        b.unmake(m);
        if (stat > best) { best = stat; bestMove = m; }
        continue;
      }
      const v = -this.search(b, depth - 1, -beta, -alpha, ply + 1);
      b.unmake(m);
      if (this.aborted) return best > -INF ? best : alpha;
      if (v > best) { best = v; bestMove = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (!((m >>> 15) & (F_CAPTURE | F_EP | F_PROMO))) this.killers[ply] = m;
        break;
      }
    }
    if (!legal) return inCheck ? -MATE + ply : 0;
    const store = best > MATE_BOUND ? best + ply : best < -MATE_BOUND ? best - ply : best;
    this.ttSet(b, depth, store, best <= a0 ? 1 : best >= beta ? 2 : 0, bestMove);
    return best;
  }
  /** Principal variation from the transposition table. */
  pv(b, maxLen) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < maxLen; i++) {
      const e = this.ttGet(b);
      if (!e || !e.move) break;
      const legal = b.legalCodes();
      if (!legal.includes(e.move) || seen.has(this.key(b))) break;
      seen.add(this.key(b));
      out.push(e.move); b.make(e.move);
    }
    for (let i = out.length - 1; i >= 0; i--) b.unmake(out[i]);
    return out;
  }
}

/**
 * Root search: best move and exact score at `depth` plies.
 * @returns {{move:number, score:number, scores:Map<number,number>, aborted:boolean, nodes:number}}
 */
export function searchRoot(board, depth, opts = {}) {
  const b = board.clone ? board.clone() : Board.fromFen(board);
  const s = opts.searcher || new Searcher(opts.nodeLimit);
  const moves = s.order(b, b.legalCodes(), 0, 0);
  let best = -INF, bestMove = 0;
  // Iterative deepening fills the table so ordering is good.
  for (let d = 1; d <= depth; d++) {
    let alpha = -INF; best = -INF;
    const ordered = bestMove ? [bestMove, ...moves.filter((m) => m !== bestMove)] : moves;
    for (const m of ordered) {
      b.make(m);
      const v = -s.search(b, d - 1, -INF, -alpha, 1);
      b.unmake(m);
      if (s.aborted) break;
      if (v > best) { best = v; bestMove = m; }
      if (v > alpha) alpha = v;
    }
    if (s.aborted) break;
    if (best > MATE_BOUND) break;
  }
  return { move: bestMove, score: best, aborted: s.aborted, nodes: s.nodes, searcher: s, depth };
}

/** True when every legal move other than `move` scores at most `threshold`. */
export function othersAtMost(board, depth, move, threshold, searcher) {
  const b = board.clone();
  const s = searcher || new Searcher();
  for (const m of b.legalCodes()) {
    if (m === move) continue;
    b.make(m);
    // Null window (threshold, threshold + 1): a result above threshold means
    // the alternative may be as good, so the move is not unique.
    const v = -s.search(b, depth - 1, -(threshold + 1), -threshold, 1);
    b.unmake(m);
    if (s.aborted) return null;
    if (v > threshold) return false;
  }
  return true;
}

function mateIn(score) { return score > MATE_BOUND ? Math.ceil((MATE - score) / 2) : 0; }

function isMate(b) { return b.inCheck() && b.legalCodes().length === 0; }

function mateMovesInOne(b) {
  const out = [];
  for (const m of b.legalCodes()) { b.make(m); if (isMate(b)) out.push(m); b.unmake(m); }
  return out;
}

// ---------------------------------------------------------------------------
// Theme detection
// ---------------------------------------------------------------------------
const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIRS = { 3: KG.slice(4), 4: KG.slice(0, 4), 5: KG };

/** Squares attacked by the piece on `from`, plus x-ray info for sliders. */
function attacks(b, from) {
  const p = b.sq[from]; if (!p) return [];
  const t = p & 7, f = from & 7, r = from >> 3, out = [];
  const on = (ff, rr) => ff >= 0 && ff < 8 && rr >= 0 && rr < 8;
  if (t === KNIGHT || t === KING) {
    for (const [df, dr] of t === KNIGHT ? KN : KG) if (on(f + df, r + dr)) out.push((r + dr) * 8 + f + df);
  } else if (t === PAWN) {
    const dir = p & 8 ? -1 : 1;
    for (const df of [-1, 1]) if (on(f + df, r + dir)) out.push((r + dir) * 8 + f + df);
  } else {
    for (const [df, dr] of DIRS[t]) {
      let ff = f + df, rr = r + dr;
      while (on(ff, rr)) { const q = rr * 8 + ff; out.push(q); if (b.sq[q]) break; ff += df; rr += dr; }
    }
  }
  return out;
}
const colorOf = (p) => (p & 8 ? 1 : 0);
const value = (p) => ((p & 7) === KING ? 10000 : VAL[p & 7]);

function defended(b, sq) { return b.isAttacked(sq, colorOf(b.sq[sq])); }

function isFork(b, to) {
  const me = b.sq[to]; if (!me) return false;
  const targets = attacks(b, to).filter((q) => b.sq[q] && colorOf(b.sq[q]) !== colorOf(me))
    .filter((q) => value(b.sq[q]) > value(me) || !defended(b, q));
  return targets.length >= 2;
}

function lineThemes(b, to) {
  const me = b.sq[to]; const t = me & 7;
  if (t !== BISHOP && t !== ROOK && t !== QUEEN) return null;
  const f = to & 7, r = to >> 3;
  for (const [df, dr] of DIRS[t]) {
    let ff = f + df, rr = r + dr, first = -1;
    while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
      const q = rr * 8 + ff, p = b.sq[q];
      if (p) {
        if (first < 0) { if (colorOf(p) === colorOf(me)) break; first = q; } else {
          if (colorOf(p) !== colorOf(me) && (p & 7) !== PAWN) {
            const a = value(b.sq[first]), c = value(p);
            if (a > c && a > VAL[t] - 1) return 'skewer';
            if (c > a && (p & 7) !== PAWN) return 'pin';
          }
          break;
        }
      }
      ff += df; rr += dr;
    }
  }
  return null;
}

function isDiscovered(before, m) {
  // A line piece of the mover now attacks a valuable target through the vacated square.
  const from = m & 63, to = (m >> 6) & 63, us = before.side;
  const b = before.clone(); b.make(m);
  for (let sq = 0; sq < 64; sq++) {
    const p = b.sq[sq]; if (!p || colorOf(p) !== us || sq === to) continue;
    const t = p & 7; if (t !== BISHOP && t !== ROOK && t !== QUEEN) continue;
    const nowA = attacks(b, sq);
    if (!nowA.length) continue;
    const beforeA = new Set(attacks(before, sq));
    for (const q of nowA) {
      const v = b.sq[q];
      if (v && colorOf(v) !== us && !beforeA.has(q) && ((v & 7) === KING || value(v) >= VAL[ROOK]) && between(sq, q).includes(from)) return true;
    }
  }
  return false;
}
function between(a, c) {
  const df = Math.sign((c & 7) - (a & 7)), dr = Math.sign((c >> 3) - (a >> 3));
  const out = []; let f = (a & 7) + df, r = (a >> 3) + dr;
  while (f !== (c & 7) || r !== (c >> 3)) { out.push(r * 8 + f); f += df; r += dr; if (f < 0 || f > 7 || r < 0 || r > 7) break; }
  return out;
}

/** Tactical motif of one solver move, or null. */
function moveMotif(before, m, reply) {
  const to = (m >> 6) & 63;
  const captured = before.sq[to];
  const b = before.clone(); b.make(m);
  if ((m >>> 15) & F_PROMO) return 'promotion';
  if (isFork(b, to)) return 'fork';
  const lt = lineThemes(b, to);
  if (lt) return lt;
  if (isDiscovered(before, m)) return 'discovered';
  // Sacrifice: the opponent captures the moved piece, which was worth more than what it took.
  if (reply != null && ((reply >> 6) & 63) === to && value(b.sq[to]) > (captured ? value(captured) : 0) + 100) return 'sacrifice';
  return null;
}

/** Theme of a verified line (codes from the puzzle start). */
export function classifyLine(fen, codes, mateN) {
  const b = Board.fromFen(fen);
  if (mateN) {
    const last = codes[codes.length - 1];
    const tmp = b.clone(); for (const c of codes) tmp.make(c);
    const k = tmp.kings[tmp.side];
    const piece = tmp.sq[(last >> 6) & 63] & 7;
    const kr = k >> 3, backRank = tmp.side ? kr === 7 : kr === 0;
    let sub = null;
    if (piece === KNIGHT && KG.every(([df, dr]) => { const ff = (k & 7) + df, rr = kr + dr; if (ff < 0 || ff > 7 || rr < 0 || rr > 7) return true; const q = tmp.sq[rr * 8 + ff]; return q && colorOf(q) === tmp.side; })) sub = 'smothered';
    else if ((piece === ROOK || piece === QUEEN) && backRank && ((last >> 6) & 63) >> 3 === kr) sub = 'back-rank';
    return { theme: `mate-in-${mateN}`, sub };
  }
  const first = codes[0];
  const capturedFirst = b.sq[(first >> 6) & 63];
  const tmp = b.clone();
  for (let i = 0; i < codes.length; i += 2) {
    const motif = moveMotif(tmp, codes[i], codes[i + 1]);
    if (motif) return { theme: motif };
    tmp.make(codes[i]); if (i + 1 < codes.length) tmp.make(codes[i + 1]);
  }
  if (capturedFirst && codes.length === 1) {
    const t = b.clone(); t.make(first);
    return { theme: t.isAttacked((first >> 6) & 63, t.side) ? 'material' : 'hanging-piece' };
  }
  if (!capturedFirst && codes.length === 1) return { theme: 'trapped-piece' };
  return { theme: 'material' };
}

// ---------------------------------------------------------------------------
// Candidate scanning and line building
// ---------------------------------------------------------------------------
const MIN_GAIN = 250;
export const STATS = {};
const bump = (k) => { STATS[k] = (STATS[k] || 0) + 1; };

/**
 * Try to build a verified puzzle from `board` (side to move solves).
 * `baseline` is the solver's material before the opponent's last move.
 * Returns null when the position is not a clean puzzle.
 */
export function buildPuzzle(board, baseline, level, opts = {}) {
  const depth = opts.depth || level.depth;
  const nodeLimit = opts.nodeLimit || 600000;
  const s = new Searcher(nodeLimit);
  const b = board.clone();
  const root = searchRoot(b, depth, { searcher: s });
  if (root.aborted || !root.move) return null;
  const mateN = mateIn(root.score);
  if (mateN) {
    if (mateN > level.maxMate) return null;
  } else {
    if (root.score < baseline + MIN_GAIN) return null;
    if (Math.abs(baseline) > 350) return null; // the game is already decided
  }
  const startFen = b.toFen();
  const codes = [];
  const alternatives = [];
  for (let step = 0; step < Math.max(level.maxSteps, mateN); step++) {
    const r = step === 0 ? root : searchRoot(b, Math.max(1, depth - step * 0), { searcher: s });
    if (r.aborted || !r.move) return null;
    const m = r.move;
    if (mateN) {
      const remaining = mateN - step;
      if (mateIn(r.score) !== remaining && mateIn(r.score) > remaining) return null;
      if (remaining === 1) {
        // Any mate in one is accepted on the final move.
        const mates = mateMovesInOne(b);
        if (!mates.length) return null;
        alternatives[codes.length] = mates.filter((x) => x !== m).map(codeToUci);
      } else {
        // No other move may force mate within the search horizon.
        const ok = othersAtMost(b, depth, m, MATE_BOUND, s);
        if (!ok) return null;
      }
    } else {
      const threshold = r.score - Math.max(200, Math.round((r.score - baseline) * 0.45));
      if (r.score < baseline + MIN_GAIN) return null;
      const ok = othersAtMost(b, depth, m, threshold, s);
      if (!ok) return null;
    }
    codes.push(m);
    b.make(m);
    if (isMate(b)) break;
    if (!mateN) {
      // Stop once the material is actually won and holds against captures.
      const stat = -material(b);
      const q = -new Searcher(50000).quiesce(b.clone(), -INF, INF, 0, 0);
      if (stat >= baseline + MIN_GAIN - 60 && q >= baseline + MIN_GAIN - 60) break;
    }
    if (step === Math.max(level.maxSteps, mateN) - 1) return null;
    // Opponent's best defence.
    const d = searchRoot(b, Math.max(1, depth - 1), { searcher: new Searcher(nodeLimit) });
    if (d.aborted || !d.move) return null;
    codes.push(d.move);
    b.make(d.move);
  }
  if (!codes.length || codes.length % 2 === 0) return null;
  if (mateN && !isMate(b)) return null;
  const solutionMate = mateN ? (codes.length + 1) / 2 : 0;
  // Discovery depth: the shallowest search that already finds the first move with a winning score.
  let discover = depth;
  for (let d = 1; d < depth; d++) {
    const t = searchRoot(Board.fromFen(startFen), d, { nodeLimit: 200000 });
    const win = solutionMate ? mateIn(t.score) > 0 : t.score >= baseline + MIN_GAIN;
    if (t.move === codes[0] && win) { discover = d; break; }
  }
  const cls = classifyLine(startFen, codes, solutionMate);
  return {
    fen: startFen,
    codes,
    solution: codes.map(codeToUci),
    alternatives,
    theme: cls.theme,
    subTheme: cls.sub || null,
    mateIn: solutionMate,
    gain: solutionMate ? null : root.score - baseline,
    discoverDepth: discover,
    playerMoves: (codes.length + 1) / 2,
    quietFirst: !((codes[0] >>> 15) & (F_CAPTURE | F_EP | F_PROMO)) && !(() => { const t = Board.fromFen(startFen); t.make(codes[0]); return t.inCheck(); })(),
  };
}

/**
 * Difficulty a built puzzle belongs to. The score combines the shallowest
 * search depth that finds the first move, the number of solver moves, the
 * mate length, and whether the first move is quiet (no capture and no check).
 */
export function complexity(p) {
  let c = p.discoverDepth + (p.playerMoves - 1) * 1.5;
  if (p.mateIn) c += p.mateIn - 1;
  if (p.quietFirst) c += 1;
  if (p.theme === 'sacrifice') c += 1;
  return c;
}
export function levelOf(p) {
  if (p.mateIn) return p.mateIn === 1 ? 'easy' : p.mateIn === 2 ? 'medium' : 'hard';
  const c = complexity(p);
  if (p.playerMoves >= 3 || c >= 4.5 || (p.playerMoves === 2 && (p.quietFirst || p.theme === 'sacrifice'))) return 'hard';
  if (p.playerMoves === 2 || c >= 3) return 'medium';
  return 'easy';
}

// ---------------------------------------------------------------------------
// Game simulation
// ---------------------------------------------------------------------------
const CENTER = new Set([27, 28, 35, 36]);

function scoreMoves(b) {
  const moves = b.legalCodes();
  const s = new Searcher(40000);
  const scored = [];
  for (const m of moves) {
    b.make(m);
    let v = -s.quiesce(b, -INF, INF, 1, 0);
    if (b.inCheck() && isMate(b)) v = MATE;
    b.unmake(m);
    // Light positional preferences keep the play natural.
    const to = (m >> 6) & 63, from = m & 63, p = b.sq[from] & 7;
    if (CENTER.has(to)) v += 12;
    if ((p === KNIGHT || p === BISHOP) && ((from >> 3) === 0 || (from >> 3) === 7)) v += 15;
    if ((m >>> 15) & 12) v += 25; // castling
    if (p === KING && !((m >>> 15) & 12)) v -= 20;
    if (p === QUEEN && b.fullmove < 8) v -= 10;
    // Pieces drift towards the enemy king, which creates attacking chances.
    if (p !== PAWN && p !== KING) { const ek = b.kings[b.side ^ 1]; if (Math.max(Math.abs((ek & 7) - (to & 7)), Math.abs((ek >> 3) - (to >> 3))) <= 2) v += 10; }
    scored.push({ m, v });
  }
  scored.sort((a, c) => c.v - a.v);
  return scored;
}

function pickPlausible(b, rand, blunderRate, scored = scoreMoves(b)) {
  const best = scored[0].v;
  if (rand() < blunderRate * 0.35) return scored[Math.floor(rand() * scored.length)].m;
  if (rand() < blunderRate) {
    // A natural mistake: any move that looks safe one move deep.
    const ok = scored.filter((x) => x.v >= best - 60);
    return ok[Math.floor(rand() * ok.length)].m;
  }
  let pick = scored[0], top = -INF;
  for (const x of scored) { const n = x.v + (rand() - 0.5) * 70; if (n > top) { top = n; pick = x; } }
  return pick.m;
}

const OPENING_POOL = OPENINGS.filter((o) => o.sans.length >= 4 && o.sans.length <= 16);

/**
 * A natural mistake: a move that looks safe after a one-move check but loses
 * to a tactic that only a deeper search sees. Returns a move code or 0.
 */
function findTrap(b, rand, level) {
  const scored = scoreMoves(b);
  const best = scored[0].v;
  const safe = scored.filter((x) => x.v >= best - 90).slice(0, 12);
  for (let i = safe.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [safe[i], safe[j]] = [safe[j], safe[i]]; }
  const shallow = Math.max(1, level.minDiscover - 1);
  let tries = 0;
  for (const { m } of safe) {
    if (++tries > 8) break;
    const before = -material(b);
    b.make(m);
    const base = Math.max(material(b), before);
    const deep = searchRoot(b, level.depth - 1, { nodeLimit: 50000 });
    let ok = !deep.aborted && (mateIn(deep.score) > 0 || deep.score >= base + MIN_GAIN) && Math.abs(base) <= 350;
    if (ok) {
      const sh = searchRoot(b, shallow, { nodeLimit: 40000 });
      if (mateIn(sh.score) > 0 || sh.score >= base + MIN_GAIN) ok = false;
    }
    b.unmake(m);
    if (ok) { bump('trapFound'); return m; }
  }
  bump('trapNone');
  return 0;
}

const LETTER = { easy: 'e', medium: 'm', hard: 'h' };
const FROM_LETTER = { e: 'easy', m: 'medium', h: 'hard' };

/**
 * Play one deterministic game from `seed` with settings for `levelId` and
 * yield every candidate puzzle found in it (each tagged with its ply), or,
 * with `targetPly`, only the candidate at that ply. Candidates have passed the
 * material search of buildPuzzle, and mate puzzles also pass an exact mate
 * check. Non-mate candidates still need the engine check in puzzle-verify.js.
 */
function* candidates(seed, levelId = 'medium', opts = {}) {
  const level = LEVELS[levelId] || LEVELS.medium;
  const rand = mulberry32(seed);
  const op = OPENING_POOL[Math.floor(rand() * OPENING_POOL.length)];
  let pos = Position.fromFen(START_FEN);
  const b = Board.fromFen(START_FEN);
  for (const san of op.sans) { const mv = pos.parseSan(san); if (!mv) break; const c = pos.moveCode(mv); b.make(c); pos = pos.makeMove(mv); }
  b._stack.length = 0;
  const extra = 6 + Math.floor(rand() * 40);
  const blunderRate = 0.18 + rand() * 0.2;
  const target = opts.targetPly;
  for (let ply = 0; ply < extra; ply++) {
    if (target != null && ply > target) break;
    if (!b.legalCodes().length || b.halfmove >= 100) break;
    const before = -material(b); // the replying side's material before this move
    let m = 0;
    if (ply >= 2 && rand() < (level.id === 'easy' ? 0.15 : 0.45)) m = findTrap(b, rand, level);
    if (!m) m = pickPlausible(b, rand, blunderRate);
    b.make(m); b._stack.length = 0;
    if (!b.legalCodes().length) break;
    if (Math.abs(material(b)) > 450) break; // the game is decided, so later positions are not useful
    if (ply < 2 || (target != null && ply !== target)) continue;
    // Baseline: the solver's material before the opponent's last move, so plain recaptures do not count.
    const baseline = Math.max(material(b), before);
    const screen = searchRoot(b, Math.min(level.depth, 3), { nodeLimit: 60000 });
    if (!(mateIn(screen.score) > 0 || screen.score >= baseline + MIN_GAIN) && target == null) continue;
    bump('promising');
    const pz = buildPuzzle(b, baseline, level, opts);
    if (!pz) { bump('buildFail'); continue; }
    pz.level = levelOf(pz);
    if (pz.mateIn && target == null) {
      // Exact check, two plies deeper than the generator searched.
      const ver = verifyGenerated(pz, level.depth + 2, 2500000);
      if (!ver.ok) { bump('verifyFail'); continue; }
    }
    pz.opening = { eco: op.eco, name: op.name };
    pz.code = `${LETTER[level.id]}${seed.toString(36)}.${ply.toString(36)}`;
    pz.ply = ply;
    yield finalize(pz);
  }
}

/**
 * Synchronous scan: every candidate of one game. The candidates are not yet
 * checked by an engine, so this is used to rebuild a puzzle from its code and
 * in tests. Use scanGameVerified for puzzles that are shown to a player.
 */
export function scanGame(seed, levelId = 'medium', opts = {}) {
  const found = [];
  for (const pz of candidates(seed, levelId, opts)) {
    found.push(pz);
    if (opts.stopAt && pz.level === opts.stopAt) break;
  }
  return found;
}

/**
 * Scan one game and keep only the candidates that the engine accepts.
 * `opts.onlyLevel` skips candidates of other levels before the engine runs,
 * because the engine check is the slow part. `opts.shouldStop()` is polled
 * between candidates so that a worker can pause.
 */
export async function scanGameVerified(seed, levelId, engine, opts = {}) {
  const out = [];
  for (const pz of candidates(seed, levelId, opts)) {
    if (opts.shouldStop && opts.shouldStop()) break;
    if (opts.onlyLevel && pz.level !== opts.onlyLevel) { bump('levelSkipped'); continue; }
    bump('engineChecked');
    const v = await verifyWithEngine(pz, engine, opts.verify);
    if (!v.ok) { bump('engineReject'); continue; }
    bump('lvl:' + pz.level);
    out.push({ ...pz, verified: true });
    if (opts.onPuzzle) opts.onPuzzle(pz);
    if (opts.stopAt && pz.level === opts.stopAt) break;
  }
  return out;
}

/**
 * Generate one puzzle of the requested level. Tries games with sub-seeds
 * derived from `seed` until the engine accepts a puzzle of that level, and
 * returns { puzzle: null } when the game or time limit is reached first.
 */
export async function generatePuzzle({ seed = randomSeed(), level = 'medium', engine, maxGames = 400, timeBudgetMs = 120000, verify } = {}) {
  const t0 = Date.now();
  let games = 0;
  for (let i = 0; i < maxGames; i++) {
    games++;
    const list = await scanGameVerified(mixSeed(seed, i), level, engine, { onlyLevel: level, stopAt: level, verify });
    if (list.length) return { puzzle: { ...list[0], generatedMs: Date.now() - t0, games }, extras: [] };
    if (Date.now() - t0 > timeBudgetMs) break;
  }
  return { puzzle: null, extras: [] };
}

const THEME_TEXT = {
  fork: 'One piece attacks two targets at once, and the opponent cannot save both.',
  pin: 'A piece is pinned to a more valuable piece behind it and cannot move without exposing that piece.',
  skewer: 'A valuable piece is attacked and must move, which exposes the piece behind it on the same line.',
  discovered: 'Moving one piece uncovers an attack by another piece along the same line.',
  sacrifice: 'Material is given up first so that a larger gain follows.',
  promotion: 'A pawn reaches the last rank and becomes a new piece.',
  'hanging-piece': 'An opponent piece is left without enough protection and can be captured.',
  'trapped-piece': 'An opponent piece has no safe square, and it is lost.',
  material: 'A forcing sequence wins material by exploiting a weakness in the opponent\'s position.',
};

export function themeLabel(theme, sub) {
  const n = { 'mate-in-1': 'Mate in one', 'mate-in-2': 'Mate in two', 'mate-in-3': 'Mate in three' }[theme];
  if (n) return sub === 'back-rank' ? `${n} (back-rank mate)` : sub === 'smothered' ? `${n} (smothered mate)` : n;
  return { fork: 'Fork', pin: 'Pin', skewer: 'Skewer', discovered: 'Discovered attack', sacrifice: 'Sacrifice', promotion: 'Promotion', 'hanging-piece': 'Hanging piece', 'trapped-piece': 'Trapped piece', material: 'Winning material' }[theme] || theme;
}

function mateLengthText(n) {
  return ['', 'one move', 'two moves', 'three moves'][n] || `${n} moves`;
}

function finalize(pz) {
  const side = pz.fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  const lvl = LEVELS[pz.level] || LEVELS.medium;
  let explanation;
  if (pz.mateIn) explanation = `${side} forces checkmate in ${mateLengthText(pz.mateIn)}, and no other first move forces mate faster.`;
  else explanation = `${THEME_TEXT[pz.theme] || THEME_TEXT.material} The solution wins about ${Math.max(2, Math.round(pz.gain / 100))} points of material, and a check with the engine on this device estimates that every other first move is at least two pawns worse.`;
  return {
    id: `gen-${pz.code}`,
    code: pz.code,
    generated: true,
    title: themeLabel(pz.theme, pz.subTheme),
    theme: pz.theme,
    subTheme: pz.subTheme,
    level: pz.level,
    difficulty: { easy: 1, medium: 3, hard: 5 }[pz.level] || 3,
    rating: Math.round(lvl.rating + complexity(pz) * 50),
    fen: pz.fen,
    solution: pz.solution,
    alternatives: pz.alternatives.map((a) => a || null),
    mateIn: pz.mateIn,
    gain: pz.gain,
    playerMoves: pz.playerMoves,
    discoverDepth: pz.discoverDepth,
    quietFirst: pz.quietFirst,
    opening: pz.opening,
    explanation,
  };
}

/** Rebuild a puzzle from its code (for example "m1x2y3z.k"). Returns null if the code is invalid.
 * The rebuild itself does not run the engine check; use verifyRebuiltPuzzle or
 * puzzleFromCodeVerified before showing a uniqueness claim to the player. */
export function puzzleFromCode(code) {
  const m = /^([emh])([0-9a-z]+)\.([0-9a-z]+)$/.exec(String(code || '').trim().toLowerCase());
  if (!m) return null;
  const seed = parseInt(m[2], 36) >>> 0;
  const ply = parseInt(m[3], 36);
  if (!Number.isFinite(ply) || ply > 200) return null;
  const list = scanGame(seed, FROM_LETTER[m[1]], { targetPly: ply });
  return list.find((p) => p.code === code.trim().toLowerCase()) || null;
}

/**
 * Stamp a rebuilt (or generated) puzzle with the result of the engine check.
 * When the check fails or the engine is missing, the uniqueness claim is
 * removed from the explanation so that it is not shown to the player.
 */
export function applyVerification(p, verified) {
  const out = { ...p, verified: !!verified };
  if (out.verified) return out;
  const side = p.fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  if (p.mateIn) {
    out.explanation = `${side} can force checkmate in ${mateLengthText(p.mateIn)}. The engine has not confirmed that no other first move forces mate faster, so that claim is not shown.`;
  } else {
    out.explanation = `${THEME_TEXT[p.theme] || THEME_TEXT.material} The engine has not confirmed that every other first move is clearly weaker, so that claim is not shown.`;
  }
  return out;
}

/** Run the same checks used during generation on a rebuilt puzzle. */
export async function verifyRebuiltPuzzle(p, engine) {
  if (!p) return null;
  if (p.mateIn) {
    const depth = (LEVELS[p.level] || LEVELS.medium).depth + 2;
    const v = verifyGenerated(p, depth, 2500000);
    return applyVerification(p, v.ok);
  }
  if (!engine) return applyVerification(p, false);
  try {
    const v = await verifyWithEngine(p, engine);
    return applyVerification(p, v.ok);
  } catch {
    return applyVerification(p, false);
  }
}

/** Rebuild a puzzle from its code and run the engine check. */
export async function puzzleFromCodeVerified(code, engine) {
  const p = puzzleFromCode(code);
  if (!p) return null;
  return verifyRebuiltPuzzle(p, engine);
}

/** Independent verification used by tests: legality, uniqueness at every solver step at a given depth. */
export function verifyGenerated(p, depth, nodeLimit = 3000000) {
  const errors = [];
  let b;
  try { b = Board.fromFen(p.fen); } catch (e) { return { ok: false, errors: ['bad fen'] }; }
  const pos0 = Position.fromFen(p.fen);
  let pos = pos0;
  const codes = [];
  for (const u of p.solution) {
    const mv = pos.parseUci(u);
    if (!mv) { errors.push(`illegal ${u}`); return { ok: false, errors }; }
    codes.push(pos.moveCode(mv)); pos = pos.makeMove(mv);
  }
  if (p.mateIn && !pos.isCheckmate()) errors.push('mate line does not end in checkmate');
  for (let i = 0; i < codes.length; i += 2) {
    // One searcher per step: its table is shared by the searches below.
    const s = new Searcher(nodeLimit * 3);
    if (p.mateIn) {
      const r = searchRoot(b, depth, { searcher: s });
      const remaining = p.mateIn - i / 2;
      if (remaining > 1) {
        if (mateIn(r.score) === 0) errors.push(`step ${i / 2 + 1}: no forced mate found`);
        const ok = othersAtMost(b, depth, codes[i], MATE_BOUND, s);
        if (ok === null) errors.push('search limit reached');
        if (ok === false) errors.push(`step ${i / 2 + 1}: another move also forces mate`);
      } else {
        b.make(codes[i]); if (!isMate(b)) errors.push('final move is not mate'); b.unmake(codes[i]);
      }
    } else {
      // The solution's own score, then a null-window proof that every other
      // move scores at least 150 centipawns less (so none scores better).
      const bb = b.clone(); bb.make(codes[i]);
      const sr = searchRoot(bb, Math.max(1, depth - 1), { searcher: s });
      if (sr.aborted) { errors.push('search limit reached'); break; }
      const solV = -sr.score;
      const ok = othersAtMost(b, depth, codes[i], solV - 150, s);
      if (ok === null) errors.push('search limit reached');
      if (ok === false) errors.push(`step ${i / 2 + 1}: an alternative is within 150 centipawns of the solution`);
          }
    b.make(codes[i]);
    if (i + 1 < codes.length) b.make(codes[i + 1]);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Solving session
// ---------------------------------------------------------------------------
/**
 * Interactive solver for a generated puzzle. A wrong move leaves the position
 * unchanged, so the player can try again from the same step.
 */
export class GeneratedSession {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.playerColor = puzzle.fen.split(' ')[1] === 'b' ? 'b' : 'w';
    this.reset();
  }
  reset() {
    this.position = Position.fromFen(this.puzzle.fen);
    this.ply = 0;
    this.hintStage = 0;
    this.complete = false;
    this.history = [this.position];
  }
  /** The solution move expected now, as a move object, or null. */
  expected() {
    const uci = this.puzzle.solution[this.ply];
    return uci ? this.position.parseUci(uci) : null;
  }
  /** Staged hint: first the piece, then the full move. */
  hint() {
    const m = this.expected();
    if (!m) return null;
    this.hintStage = Math.min(2, this.hintStage + 1);
    return this.hintStage === 1 ? { from: m.from } : { from: m.from, to: m.to };
  }
  /**
   * Try a player move. Returns {status:'wrong'} (nothing changes),
   * {status:'correct', move, reply} or {status:'complete', move}.
   */
  tryMove(move) {
    if (this.complete) return { status: 'complete' };
    const code = this.position.moveCode(move);
    if (code === -1) return { status: 'wrong' };
    const mv = this.position.codeToMove(code);
    const uci = this.position.moveToUci ? this.position.moveToUci(mv) : codeToUci(code);
    const alts = (this.puzzle.alternatives && this.puzzle.alternatives[this.ply]) || [];
    const ok = uci === this.puzzle.solution[this.ply] || alts.includes(uci);
    if (!ok) return { status: 'wrong', move: mv };
    this.position = this.position.makeMove(mv);
    this.history.push(this.position);
    this.ply++;
    this.hintStage = 0;
    if (this.ply >= this.puzzle.solution.length || this.position.isCheckmate()) { this.complete = true; return { status: 'complete', move: mv }; }
    const reply = this.position.parseUci(this.puzzle.solution[this.ply]);
    this.position = this.position.makeMove(reply);
    this.history.push(this.position);
    this.ply++;
    return { status: 'correct', move: mv, reply };
  }
  /** Remaining solution moves from the current position, as move objects. */
  remaining() {
    const out = [];
    let p = this.position;
    for (let i = this.ply; i < this.puzzle.solution.length; i++) {
      const m = p.parseUci(this.puzzle.solution[i]);
      if (!m) break;
      out.push(m); p = p.makeMove(m);
    }
    return out;
  }
}
