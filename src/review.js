/**
 * Post-game review: winning-chance classification, accuracy scores, and
 * extraction of personal mistake puzzles. Pure ES module (no DOM). The
 * scheme is documented in NOTES-review.md. Move labels follow chess.com
 * Classification V2 (expected-points bands and special categories), using a
 * rating-neutral approximation of expected points. Game accuracy follows the
 * Lichess AccuracyPercent implementation fetched on 2026-11-23.
 */
import { Position, START_FEN, PIECE_VALUES } from './engine.js';
import { identifyOpening } from './openings.js';
import { toCp, WIN_CP, GAP_CP, ALT_WIN_CP, ALT_MARGIN_CP } from './puzzle-verify.js';

export { toCp, WIN_CP, GAP_CP, ALT_WIN_CP, ALT_MARGIN_CP };

export const SCHEME_VERSION = 8;
export const SCHEME_ID = 'ornate-review-v8';
export const REVIEW_DEPTH = 12;

/** Lichess winning-chances constant (scalachess WinPercent, lila pull 11148). */
export const WC_K = 0.00368208;

/** Centipawn ceiling used by scalachess Eval.Cp.CEILING and WinPercent.fromCentiPawns. */
export const CP_CEILING = 1000;

/** Absolute toCp magnitude at or above which a score is treated as a mate. */
export const MATE_CP = 10000;

/**
 * Judgment bands on the 0–100 win-percent scale. These are 5, 10 and 15
 * points, matching Lichess CpAdvice thresholds of 0.1, 0.2 and 0.3 on the
 * −1 to +1 winningChances scale.
 */
export const BEST_LOSS = 1;
export const INACCURACY_LOSS = 5;
export const MISTAKE_LOSS = 10;
export const BLUNDER_LOSS = 15;

/** MateAdvice centipawn cut-offs from lila Advice.scala (mover's point of view). */
export const MATE_INACCURACY_CP = 999;
export const MATE_MISTAKE_CP = 700;

/** After a missed win the position must be below this many centipawns. */
export const MISS_AFTER_CP = 100;

export const JUDGMENTS = Object.freeze([
  'brilliant', 'great', 'best', 'excellent', 'good', 'book',
  'inaccuracy', 'mistake', 'miss', 'blunder', 'forced',
]);
export const FLAGGED = Object.freeze(['inaccuracy', 'mistake', 'miss', 'blunder']);
export const MISTAKE_JUDGMENTS = Object.freeze(['mistake', 'miss', 'blunder']);

export const JUDGMENT_LABELS = Object.freeze({
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
  forced: 'Forced',
});

/**
 * Expected-points loss bands from chess.com Classification V2 (support article
 * dated 9 February 2026). Applied to this application's rating-neutral
 * approximation of expected points (Lichess win chances divided by 100).
 * Best is reserved for a zero loss, or for the engine's top move. Other bands
 * are lower-exclusive and upper-inclusive.
 */
export const EP_EXCELLENT = 0.02;
export const EP_GOOD = 0.05;
export const EP_INACCURACY = 0.10;
export const EP_MISTAKE = 0.20;
export const THREAT_EP = 0.05;
export const BRILLIANT_WINNING_WP = 80;
export const BRILLIANT_SAFE_WP = 45;
export const GREAT_LOSING_WP = 35;
export const GREAT_EQUAL_WP = 45;
export const GREAT_WINNING_WP = 75;
export const GREAT_ONLY_MOVE_EP = 0.10;
export const MISS_WINNING_CP = 200;
export const MISS_WINNING_WP = 75;
export const MISS_PLAYED_CP = 100;
export const BOOK_MAX_EP = 0.05;

/** Minimum material the opponent must be able to win, after a capture sequence, for a sacrifice or a threat arrow. An exchange (rook for a minor piece) is about 200 centipawns; a minor piece is at least 300. */
export const SACRIFICE_CP = 200;

/** Mate threats longer than this are shown only when the side to move has a choice. */
export const MATE_THREAT_MAX = 3;


/** Lichess AccuracyPercent.fromWinPercents constants (including the +1 bonus). */
export const ACC_A = 103.1668100711649;
export const ACC_K = 0.04354415386753951;
export const ACC_B = -3.166924740191411;
export const ACC_UNCERTAINTY = 1;

/** Winning chances in the range -1 to 1, from a (possibly unceiled) centipawn score. */
export function winningChances(cp) {
  const x = Number(cp) || 0;
  const w = 2 / (1 + Math.exp(-WC_K * x)) - 1;
  return Math.max(-1, Math.min(1, w));
}

/** Clamp a centipawn score to the Lichess ±1000 ceiling. */
export function ceilCp(cp) {
  const x = Number(cp);
  if (!Number.isFinite(x)) return 0;
  return Math.max(-CP_CEILING, Math.min(CP_CEILING, x));
}

/** Invert an engine score so it is seen from the opposite side. */
export function invertScore(s) {
  if (!s) return { kind: 'cp', value: 0 };
  if (s.kind === 'mate') return { kind: 'mate', value: -(Number(s.value) || 0) };
  return { kind: 'cp', value: -(Number(s.value) || 0) };
}

/**
 * Map an engine score to the centipawn value Lichess uses for win chances:
 * mates become ±1000, and other scores are capped at ±1000.
 */
export function lichessCp(score) {
  if (score == null) return 0;
  if (typeof score !== 'object') {
    const x = Number(score);
    if (!Number.isFinite(x)) return 0;
    if (Math.abs(x) >= MATE_CP) return x > 0 ? CP_CEILING : -CP_CEILING;
    return ceilCp(x);
  }
  if (score.kind === 'mate') return (Number(score.value) || 0) > 0 ? CP_CEILING : -CP_CEILING;
  const v = Number(score.value);
  if (!Number.isFinite(v)) return 0;
  if (Math.abs(v) >= MATE_CP) return v > 0 ? CP_CEILING : -CP_CEILING;
  return ceilCp(v);
}

/** True when the score is a forced mate (including mate 0, which is checkmate). */
export function isMateScore(score) {
  if (score == null) return false;
  if (typeof score === 'object') {
    if (score.kind === 'mate') return true;
    return Math.abs(Number(score.value) || 0) >= MATE_CP;
  }
  return Math.abs(Number(score) || 0) >= MATE_CP;
}

/** Sign of a mate: +1 if this side mates, −1 if this side is mated (including mate 0). */
export function mateSign(score) {
  if (!isMateScore(score)) return 0;
  if (typeof score === 'object') {
    if (score.kind === 'mate') return (Number(score.value) || 0) > 0 ? 1 : -1;
    return (Number(score.value) || 0) > 0 ? 1 : -1;
  }
  return (Number(score) || 0) > 0 ? 1 : -1;
}

/** Raw centipawns when the score is not a mate, otherwise 0 (MateAdvice). */
export function cpOrZero(score) {
  if (isMateScore(score)) return 0;
  if (typeof score === 'object') return Number(score.value) || 0;
  return Number(score) || 0;
}

/** Winning-chance percentage in the range 0 to 100, after the Lichess cap. */
export function winPercent(cpOrScore) {
  return 50 + 50 * winningChances(lichessCp(cpOrScore));
}

/**
 * Accuracy percentage for a given winning-chance loss (0–100 points),
 * including Lichess's +1 uncertainty bonus, clamped to 0–100.
 */
export function accuracyPercent(loss) {
  const d = Math.max(0, Number(loss) || 0);
  if (d === 0) return 100;
  const raw = ACC_A * Math.exp(-ACC_K * d) + ACC_B + ACC_UNCERTAINTY;
  return Math.max(0, Math.min(100, raw));
}

/** Per-move accuracy from two 0–100 win percents (AccuracyPercent.fromWinPercents). */
export function accuracyFromWinPercents(before, after) {
  if (after >= before) return 100;
  return accuracyPercent(before - after);
}

/** True when a winning continuation was available and was not taken. Used by the Miss rule. */
export function isMissedWin(bestCp, playedCp) {
  const bestWinning = bestCp >= WIN_CP || bestCp >= MATE_CP;
  const stillWinning = playedCp >= MISS_AFTER_CP || playedCp >= MATE_CP;
  return bestWinning && !stillWinning;
}

export function expectedPoints(score) {
  return winPercent(score) / 100;
}

export function epLossOf(before, after) {
  return Math.max(0, expectedPoints(before) - expectedPoints(after));
}

function materialOf(pos, color) {
  let s = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.pieceAt(sq);
    if (p && p.color === color) s += (PIECE_VALUES[p.type] || 0);
  }
  return s;
}

function capturerValue(move) {
  if (!move) return 0;
  if (move.promotion) return PIECE_VALUES[move.promotion] || 0;
  return PIECE_VALUES[move.piece] || 0;
}

function captureGain(move) {
  if (!move) return 0;
  let gain = PIECE_VALUES[move.captured] || 0;
  if (move.promotion) gain += (PIECE_VALUES[move.promotion] || 0) - (PIECE_VALUES.p || 100);
  return gain;
}

/**
 * Static exchange evaluation for a capture on `sq` by the side to move.
 * Both sides continue with the least valuable legal capturer, and a side
 * may stand pat when recapturing would lose material. The result is the
 * material the side to move can win on that square, in centipawns.
 */
export function staticExchange(pos, sq) {
  if (!pos || sq == null) return 0;
  const caps = pos.legalMoves().filter((m) => m.to === sq && (m.captured || m.promotion));
  if (!caps.length) return 0;
  caps.sort((a, b) => capturerValue(a) - capturerValue(b));
  const m = caps[0];
  const gain = captureGain(m);
  const next = pos.makeMove(m);
  const recapture = staticExchange(next, sq);
  return Math.max(0, gain - recapture);
}

/** Largest static exchange the side to move can win against `defender`. */
export function maxStaticExchange(pos, defender) {
  if (!pos || pos.turn === defender) return 0;
  const targets = new Set();
  for (const m of pos.legalMoves()) {
    if (m.captured) targets.add(m.to);
  }
  let best = 0;
  for (const sq of targets) {
    const v = staticExchange(pos, sq);
    if (v > best) best = v;
  }
  return best;
}

function opponentToMove(pos, mover) {
  if (!pos) return null;
  if (pos.turn !== mover) return pos;
  try {
    const flipped = Position.fromFen(fenWithNullMove(pos.toFen()));
    if (flipped.inCheck()) return null;
    return flipped;
  } catch {
    return null;
  }
}

/**
 * True when the moved piece is offered on its landing square: the opponent
 * can win at least an exchange there, and after netting what the mover just
 * captured, the mover is still down at least a pawn. This is the rule that
 * treats 10.Nxb5 in the Opera Game as a sacrifice and rejects equal trades.
 */
export function isLandingSacrifice(afterPos, move) {
  if (!afterPos || !move) return false;
  const landingSee = staticExchange(afterPos, move.to);
  const landingNet = landingSee - captureGain(move);
  const offered = (PIECE_VALUES[move.piece] || 0) >= 300;
  return offered && landingNet >= 100 && landingSee >= SACRIFICE_CP;
}

function moveKey(m) {
  if (!m) return '';
  return `${m.from}-${m.to}-${m.promotion || ''}`;
}

/**
 * Squares of `defender`'s pieces that the opponent can win by a static
 * exchange of at least SACRIFICE_CP. `pos` may already have the opponent
 * to move; if not, a null-move flip is used.
 */
export function hangingExchanges(pos, defender) {
  if (!pos) return [];
  const attackPos = pos.turn === defender ? opponentToMove(pos, defender) : pos;
  if (!attackPos) return [];
  const out = [];
  const seen = new Set();
  for (const m of attackPos.legalMoves()) {
    if (!m.captured || seen.has(m.to)) continue;
    seen.add(m.to);
    const value = staticExchange(attackPos, m.to);
    if (value >= SACRIFICE_CP) out.push({ sq: m.to, value });
  }
  return out;
}

/**
 * Candidate alternatives from `before`, excluding `playedMove`: legal moves
 * of pieces hanging after the played move, legal captures of their attackers,
 * and optional engine moves in `opts.candidates` (UCI strings).
 */
export function sacrificeAlternatives(before, playedMove, hangingAfter, opts = {}) {
  if (!before || !playedMove) return [];
  const hangSet = new Set((hangingAfter || []).map((h) => h.sq));
  const movers = before.turn;
  const opp = opponentToMove(before, movers);
  const attackers = new Set();
  if (opp) {
    for (const m of opp.legalMoves()) {
      if (hangSet.has(m.to) && staticExchange(opp, m.to) >= SACRIFICE_CP) attackers.add(m.from);
    }
  }
  const played = moveKey(playedMove);
  const out = [];
  const seen = new Set();
  const add = (m) => {
    if (!m) return;
    const k = moveKey(m);
    if (!k || k === played || seen.has(k)) return;
    seen.add(k);
    out.push(m);
  };
  for (const m of before.legalMoves()) {
    if (hangSet.has(m.from) || attackers.has(m.to)) add(m);
  }
  for (const uci of opts.candidates || []) {
    add(typeof uci === 'string' ? before.parseUci(uci) : uci);
  }
  return out;
}

function alternativeSavesHang(before, alt, hangSet, mover) {
  const next = before.makeMove(alt);
  const nextOpp = next.turn === mover ? opponentToMove(next, mover) : next;
  if (!nextOpp) return false;
  const still = new Set(hangingExchanges(nextOpp, mover).map((h) => h.sq));
  for (const sq of hangSet) {
    if (alt.from === sq) {
      if (!still.has(alt.to)) return true;
    } else if (!still.has(sq)) {
      return true;
    }
  }
  return false;
}

/**
 * True when the mover had at least one candidate alternative that would have
 * avoided losing material left hanging after `playedMove`. Saving a hanging
 * queen counts even when another piece remains en prise. Material that was
 * already lost, with no saving alternative, does not count.
 */
export function hasSavingAlternative(before, playedMove, hangingAfter, opts = {}) {
  if (!before || !playedMove || !hangingAfter || !hangingAfter.length) return false;
  const hangSet = new Set(hangingAfter.map((h) => h.sq));
  const mover = before.turn;
  for (const alt of sacrificeAlternatives(before, playedMove, hangingAfter, opts)) {
    if (alternativeSavesHang(before, alt, hangSet, mover)) return true;
  }
  return false;
}

/**
 * A real sacrifice compared with the position before the move. A new offer
 * on the landing square, including a minor or major given for one or two
 * pawns, still counts. Material left en prise after the move also counts
 * when the mover had a legal alternative that would have saved that
 * material (for example 17...Be6 in Byrne–Fischer, leaving the queen
 * hanging when it could have been moved to safety). It does not count when
 * the material was already lost with no saving alternative, and defended
 * equal trades do not count.
 */
export function isPieceSacrifice(before, after, move, opts = {}) {
  if (!before || !after || !move) return false;
  const mover = before.turn;
  const afterPos = after.turn === mover ? opponentToMove(after, mover) : after;
  if (!afterPos) return false;
  if (isLandingSacrifice(afterPos, move)) return true;
  const hang = maxStaticExchange(afterPos, mover);
  if (hang < SACRIFICE_CP) return false;
  const landingSee = staticExchange(afterPos, move.to);
  const landingNet = landingSee - captureGain(move);
  if (landingSee === hang && landingNet < 100) return false;
  const beforePos = opponentToMove(before, mover);
  const hangBefore = beforePos ? maxStaticExchange(beforePos, mover) : 0;
  if (hangBefore >= SACRIFICE_CP && hang - hangBefore < SACRIFICE_CP) {
    return hasSavingAlternative(before, move, hangingExchanges(afterPos, mover), opts);
  }
  return true;
}

function epBand(loss, isBestMove) {
  if (isBestMove || loss <= 0) return 'best';
  if (loss <= EP_EXCELLENT) return 'excellent';
  if (loss <= EP_GOOD) return 'good';
  if (loss <= EP_INACCURACY) return 'inaccuracy';
  if (loss <= EP_MISTAKE) return 'mistake';
  return 'blunder';
}

/** Expected-points band only, ignoring Brilliant, Great, Miss, Book and Forced. */
export function classifyByExpectedPoints(loss, isBestMove = false) {
  return epBand(loss, isBestMove);
}

function isMateInOne(score) {
  if (!score) return false;
  if (score.kind === 'mate') return Number(score.value) === 1;
  return toCp(score) >= MATE_CP - 1 && toCp(score) < MATE_CP + 50 && toCp(score) >= 19900;
}

function isWinningScore(score, fallbackCp) {
  const s = asScore(score, fallbackCp);
  if (isMateScore(s) && mateSign(s) > 0) return true;
  return toCp(s) >= MISS_WINNING_CP;
}

function asScore(input, fallbackCp) {
  if (input && typeof input === 'object' && (input.kind === 'cp' || input.kind === 'mate')) return input;
  const cp = fallbackCp;
  if (cp == null || !Number.isFinite(Number(cp))) return { kind: 'cp', value: 0 };
  const v = Number(cp);
  if (Math.abs(v) >= MATE_CP) return { kind: 'mate', value: v > 0 ? Math.max(1, 20000 - v) : -Math.max(0, 20000 + v) };
  return { kind: 'cp', value: v };
}

/**
 * Classification of one move from the mover's point of view.
 *
 * Accuracy still uses Lichess AccuracyPercent (see accuracyFromWinPercents).
 * The label set and expected-points bands follow chess.com Classification V2
 * as published on 9 February 2026. The expected-points curve itself is a
 * rating-neutral approximation (Lichess win chances), because chess.com does
 * not publish its rating-aware model. Brilliant, Great and Miss are
 * documented approximations of the published prose rules. Forced is used in
 * chess.com's review UI but is not in the official V2 table.
 *
 * @param {{
 *   bestCp?: number, playedCp?: number,
 *   bestScore?: object, playedScore?: object,
 *   isBestMove?: boolean, legalCount?: number,
 *   secondScore?: object|null, isBook?: boolean,
 *   isSacrifice?: boolean, opponentBlundered?: boolean,
 * }} input
 */
export function classifyMove(input = {}) {
  const bestScore = asScore(input.bestScore, input.bestCp);
  const playedScore = asScore(input.playedScore, input.playedCp);
  const bestCp = toCp(bestScore);
  const playedCp = toCp(playedScore);
  const winBefore = winPercent(bestScore);
  const winAfter = winPercent(playedScore);
  const lossWp = Math.max(0, winBefore - winAfter);
  const loss = lossWp / 100;
  const accuracy = accuracyFromWinPercents(winBefore, winAfter);
  const legalCount = input.legalCount == null ? 99 : input.legalCount;
  const forced = legalCount === 1;
  const isBestMove = !!input.isBestMove;
  const secondLoss = input.secondScore ? epLossOf(bestScore, asScore(input.secondScore, input.secondCp)) : 0;

  let judgment;
  if (forced) {
    judgment = 'forced';
  } else if (input.isBook && loss <= BOOK_MAX_EP) {
    judgment = 'book';
  } else if (
    input.isSacrifice
    && (isBestMove || loss <= EP_EXCELLENT)
    && winAfter >= BRILLIANT_SAFE_WP
    && winBefore < BRILLIANT_WINNING_WP
  ) {
    judgment = 'brilliant';
  } else if (
    (isBestMove || loss <= EP_EXCELLENT)
    && (
      (
        secondLoss >= GREAT_ONLY_MOVE_EP
        && !input.isRecapture
        && !isMateInOne(bestScore)
        && winBefore < GREAT_WINNING_WP
      )
      || (winBefore < GREAT_LOSING_WP && winAfter >= GREAT_EQUAL_WP)
      || (winBefore >= GREAT_EQUAL_WP && winBefore < GREAT_WINNING_WP && winAfter >= GREAT_WINNING_WP)
    )
  ) {
    judgment = 'great';
  } else if (
    input.opponentBlundered
    && (isMissedWin(bestCp, playedCp) || ((bestCp >= MISS_WINNING_CP || winBefore >= MISS_WINNING_WP || isMateScore(bestScore)) && playedCp < MISS_PLAYED_CP && loss >= EP_GOOD))
  ) {
    judgment = 'miss';
  } else if (isBestMove) {
    judgment = 'best';
  } else {
    judgment = epBand(loss, false);
  }

  return {
    judgment,
    forced,
    winBefore,
    winAfter,
    loss: lossWp,
    epLoss: loss,
    accuracy,
  };
}

function uciSquares(uci) {
  if (!uci || uci.length < 4) return null;
  const files = 'abcdefgh';
  const fromFile = files.indexOf(uci[0]);
  const toFile = files.indexOf(uci[2]);
  const fromRank = +uci[1];
  const toRank = +uci[3];
  if (fromFile < 0 || toFile < 0 || fromRank < 1 || fromRank > 8 || toRank < 1 || toRank > 8) return null;
  return { from: fromFile + (fromRank - 1) * 8, to: toFile + (toRank - 1) * 8 };
}

/**
 * Walk a principal variation from `pos`, returning SAN and a truncated UCI list.
 * @param {import('./engine.js').Position} pos
 * @param {{ move?: string, pv?: string[], kind?: string, value?: number }|null} line
 * @param {number} [maxPlies]
 */
export function lineFromPv(pos, line, maxPlies = 12) {
  if (!pos || !line) return { uci: [], san: [], eval: null };
  const raw = (line.pv && line.pv.length ? line.pv : (line.move ? [line.move] : [])).filter(Boolean);
  const uci = [];
  const san = [];
  let p = pos;
  for (const u of raw.slice(0, maxPlies)) {
    const m = p.parseUci(u);
    if (!m) break;
    san.push(p.toSan(m));
    uci.push(u);
    p = p.makeMove(m);
  }
  const ev = (line.kind === 'mate' || line.kind === 'cp') ? { kind: line.kind, value: line.value } : null;
  return { uci, san, eval: ev };
}

/** Flip the side to move and clear en passant, for a null-move threat search. */
export function fenWithNullMove(fen) {
  const parts = String(fen || '').split(' ');
  if (parts.length < 4) return fen;
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}

/** Mate distance in full moves, or 0 when the score is not a mate. */
export function mateLength(score) {
  if (!score) return 0;
  if (score.kind === 'mate') return Math.abs(Number(score.value) || 0);
  if (isMateScore(score)) {
    const cp = toCp(score);
    if (Math.abs(cp) >= MATE_CP - 50) return Math.max(1, MATE_CP - Math.abs(cp));
  }
  return 0;
}

/**
 * How much material the side to move would win by playing `threat` on `pos`,
 * after netting a capture the previous mover just made on the same square.
 * Equal-trade recaptures therefore score about 0, not a full piece.
 */
export function threatExchangeGain(pos, threatMove, playedMove = null) {
  if (!pos || !threatMove) return 0;
  const see = staticExchange(pos, threatMove.to);
  const prior = (playedMove && playedMove.to === threatMove.to) ? captureGain(playedMove) : 0;
  return see - prior;
}

export function threatIsMeaningful(pos, threat, playedMove = null) {
  if (!pos || !threat || !threat.move) return false;
  const m = pos.parseUci(threat.move);
  if (!m) return false;
  const matesIn = mateLength(threat);
  if (matesIn > 0 && (threat.kind === 'mate' ? (Number(threat.value) || 0) > 0 : toCp(threat) >= MATE_CP - 50)) {
    if (matesIn <= MATE_THREAT_MAX) return true;
    return pos.legalMoves().length > 1;
  }
  if (!m.captured && !m.promotion) return false;
  return threatExchangeGain(pos, m, playedMove) >= SACRIFICE_CP;
}

/**
 * Suggestion and threat arrow geometry for a reviewed move.
 * Threat arrows belong on the position after the move (the opponent to move).
 * Suggestion arrows are from the pre-move position; when `afterPos` is given
 * they are always included. When the origin square is empty on the board
 * after the played move, the review page draws a ghost of the piece that
 * should have moved, so the arrow still starts from the pre-move origin
 * while the badge stays on the moved piece.
 */
function pieceTypeAt(pos, sq) {
  if (!pos || sq == null || typeof pos.pieceAt !== 'function') return null;
  const pc = pos.pieceAt(sq);
  return pc && pc.type ? pc.type : null;
}

export function reviewArrowsForMove(move, afterPos = null, beforePos = null) {
  const out = [];
  if (!move) return out;
  if (move.suggestionUci && move.suggestionUci !== move.uci) {
    const sq = uciSquares(move.suggestionUci);
    if (sq) {
      const piece = pieceTypeAt(beforePos, sq.from) || pieceTypeAt(afterPos, sq.from);
      out.push({ from: sq.from, to: sq.to, kind: 'suggest', uci: move.suggestionUci, piece });
    }
  }
  if (move.threatUci) {
    const sq = uciSquares(move.threatUci);
    if (sq) {
      const piece = pieceTypeAt(afterPos, sq.from) || pieceTypeAt(beforePos, sq.from);
      out.push({ from: sq.from, to: sq.to, kind: 'threat', uci: move.threatUci, piece });
    }
  }
  return out;
}

/**
 * Whether the engine's top line is a clearly unique best move, using the
 * same margin rules as generated puzzles (see src/puzzle-verify.js).
 * `lines` is [{ move, kind, value }, ...] ordered from best to worst, from
 * the side to move. Forced mates are accepted when no other first move
 * mates at least as quickly, unless `uniqueMate` is set, in which case any
 * other mating first move is rejected.
 */
export function passesMarginRules(lines, opts = {}) {
  const win = opts.win ?? WIN_CP;
  const gap = opts.gap ?? GAP_CP;
  const altWin = opts.altWin ?? ALT_WIN_CP;
  const altMargin = opts.altMargin ?? ALT_MARGIN_CP;
  if (!lines || !lines.length || !lines[0] || !lines[0].move) return false;
  const topCp = toCp(lines[0]);
  const sec = lines[1];
  if (topCp >= MATE_CP) {
    if (!sec) return true;
    if (opts.uniqueMate && toCp(sec) >= MATE_CP) return false;
    return toCp(sec) < topCp;
  }
  if (topCp < win) return false;
  if (sec && topCp - toCp(sec) < gap) return false;
  if (sec && toCp(sec) > altWin && topCp - toCp(sec) < altMargin) return false;
  return true;
}

/** Margin rules for My mistakes: any second mating first move is rejected. */
export function passesMistakeMarginRules(lines, opts = {}) {
  return passesMarginRules(lines, { ...opts, uniqueMate: true });
}

/** True when this colour's move belongs to the user, not the bot. */
export function isUserMove(mode, playerColor, moveColor) {
  if (mode === 'bot') return moveColor === (playerColor === 'b' ? 'b' : 'w');
  return true;
}

/**
 * Replay a move list and return every position, the move objects and SAN.
 * Throws if a move is illegal.
 */
export function replayGame(startFen, uci) {
  const fen = startFen || START_FEN;
  let pos = Position.fromFen(fen);
  const positions = [pos];
  const moves = [];
  const sans = [];
  for (const u of uci || []) {
    const m = pos.parseUci(u);
    if (!m) throw new Error(`The move ${u} is not legal in this position.`);
    sans.push(pos.toSan(m));
    moves.push(m);
    pos = pos.makeMove(m);
    positions.push(pos);
  }
  return { startFen: fen, positions, moves, sans, uci: [...(uci || [])] };
}

/**
 * Engine pass of a review: evaluate every position of a replayed game, from
 * the side to move, with MultiPV 2 at `depth`. The page worker, the timing
 * tool and the engine regression test all use this function, so they run
 * the same pipeline. `engine.analyse(fen, { depth, multipv })` must resolve
 * with lines ordered best first. Positions with no legal move are scored
 * without the engine (checkmate or stalemate).
 */
export async function analyseGame(engine, replayed, { depth = REVIEW_DEPTH, onProgress, isCancelled } = {}) {
  const evals = [];
  const total = replayed.positions.length;
  for (let i = 0; i < total; i++) {
    if (isCancelled && isCancelled()) throw new Error('cancelled');
    const pos = replayed.positions[i];
    const legal = pos.legalMoves().length;
    let lines;
    if (legal === 0) {
      lines = pos.isCheckmate()
        ? [{ move: '', kind: 'cp', value: -20000 }]
        : [{ move: '', kind: 'cp', value: 0 }];
    } else {
      lines = await engine.analyse(pos.toFen(), { depth, multipv: Math.min(2, legal) });
    }
    evals.push({ fen: pos.toFen(), turn: pos.turn, lines });
    if (onProgress) onProgress(i + 1, total, i);
  }
  return evals;
}

/** Centipawn score from White's point of view (internal toCp mapping). */
export function whiteCpFrom(score, turn) {
  const cp = toCp(score);
  return turn === 'w' ? cp : -cp;
}

/**
 * White-POV evaluation of a stored engine line after `step` plies have been
 * played. Centipawn scores stay at the root value, because the review only
 * stores one score per line. Mate scores count down by one full move every
 * two plies, so the bar follows the remaining mate distance.
 */
export function lineEvalAtStep(line, startTurn, step) {
  if (!line || !line.eval) return null;
  const ev = line.eval;
  if (ev.kind === 'mate') {
    const n = Number(ev.value) || 0;
    if (n === 0) return whiteCpFrom(ev, startTurn);
    // Mate count falls after the mating side moves: after odd plies when the
    // starting side is mating, and after even plies when they are being mated.
    const used = n > 0
      ? Math.ceil(Math.max(0, step) / 2)
      : Math.floor(Math.max(0, step) / 2);
    const remaining = n > 0 ? Math.max(1, n - used) : Math.min(-1, n + used);
    return whiteCpFrom({ kind: 'mate', value: remaining }, startTurn);
  }
  return whiteCpFrom(ev, startTurn);
}

/** Lichess-capped centipawn score from White's point of view, for win chances. */
export function whiteLichessCp(score, turn) {
  const cp = lichessCp(score);
  return turn === 'w' ? cp : -cp;
}

/** Display form of a White-point-of-view centipawn score, for example +1.2 or −M3. */
export function formatWhiteEval(whiteCp) {
  if (whiteCp == null || !Number.isFinite(whiteCp)) return '';
  if (Math.abs(whiteCp) >= MATE_CP) {
    const n = 20000 - Math.abs(whiteCp);
    return (whiteCp > 0 ? 'M' : '−M') + Math.max(1, n);
  }
  const v = whiteCp / 100;
  const body = Math.abs(v).toFixed(1);
  if (v > 0) return '+' + body;
  if (v < 0) return '−' + body;
  return '0.0';
}

function emptyCounts() {
  const o = {};
  for (const j of JUDGMENTS) o[j] = 0;
  return o;
}

/** Population standard deviation, as in scalalib Maths.standardDeviation. */
export function standardDeviation(values) {
  const a = Array.isArray(values) ? values : [];
  if (!a.length) return null;
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const sum = a.reduce((s, x) => s + (x - mean) * (x - mean), 0);
  return Math.sqrt(sum / a.length);
}

/** Weighted arithmetic mean of [value, weight] pairs (scalalib Maths.weightedMean). */
export function weightedMean(pairs) {
  if (!pairs || !pairs.length) return null;
  let sv = 0, sw = 0;
  for (const [v, w] of pairs) {
    sv += v * w;
    sw += w;
  }
  return sw === 0 ? null : sv / sw;
}

/**
 * Harmonic mean, matching scalalib Maths.harmonicMean, which substitutes
 * Math.max(1, v) so values below 1 cannot inflate the result.
 */
export function harmonicMean(values) {
  if (!values || !values.length) return null;
  let s = 0;
  for (const v of values) s += 1 / Math.max(1, v);
  return values.length / s;
}

/**
 * Game accuracy for each colour from a list of White-point-of-view win
 * percents, one per position including the start. This follows
 * AccuracyPercent.gameAccuracy: a mean of a volatility-weighted mean and a
 * harmonic mean, with a sliding window whose size is
 * clamp(floor((n − 1) / 10), 2, 8).
 */
export function gameAccuracy(startColor, whiteWinPercents) {
  const all = Array.isArray(whiteWinPercents) ? whiteWinPercents : [];
  const n = all.length;
  if (n < 2) return { w: null, b: null };
  const windowSize = Math.max(2, Math.min(8, Math.floor((n - 1) / 10)));
  const first = all.slice(0, Math.min(windowSize, n));
  const pad = Math.max(0, Math.min(windowSize, n) - 2);
  const windows = [];
  for (let i = 0; i < pad; i++) windows.push(first);
  for (let i = 0; i + windowSize <= n; i++) windows.push(all.slice(i, i + windowSize));
  const weights = windows.map((w) => {
    const sd = standardDeviation(w);
    if (sd == null) return null;
    return Math.max(0.5, Math.min(12, sd));
  });
  const by = { w: [], b: [] };
  const startWhite = startColor !== 'b';
  const limit = Math.min(n - 1, weights.length);
  for (let i = 0; i < limit; i++) {
    const p = all[i], nxt = all[i + 1];
    const whiteMove = (i % 2 === 0) === startWhite;
    const color = whiteMove ? 'w' : 'b';
    const before = whiteMove ? p : nxt;
    const after = whiteMove ? nxt : p;
    const acc = accuracyFromWinPercents(before, after);
    const w = weights[i];
    if (w == null) continue;
    by[color].push([acc, w]);
  }
  const side = (arr) => {
    if (!arr.length) return null;
    const wm = weightedMean(arr);
    const hm = harmonicMean(arr.map((x) => x[0]));
    if (wm == null || hm == null) return null;
    return (wm + hm) / 2;
  };
  return { w: side(by.w), b: side(by.b) };
}

/**
 * Build a complete review from per-position engine lines.
 * `evals[i]` describes the position before move i (and the final position),
 * as `{ fen, turn, lines: [{ move, kind, value }] }`.
 */
export function buildReview({ startFen, uci, mode = 'local', playerColor = 'w', depth = REVIEW_DEPTH, name = '', gameId = null, evals, sans: givenSans }) {
  const replayed = replayGame(startFen, uci);
  if (!evals || evals.length !== replayed.positions.length) {
    throw new Error('The review is missing an evaluation for every position.');
  }
  const sans = givenSans && givenSans.length === replayed.sans.length ? givenSans : replayed.sans;
  const moves = [];
  const counts = { w: emptyCounts(), b: emptyCounts(), player: emptyCounts() };
  const mistakes = [];
  let lastBookPly = 0;
  if (replayed.startFen === START_FEN) {
    const opening = identifyOpening(replayed.uci);
    lastBookPly = opening && opening.lastBookPly ? opening.lastBookPly : 0;
  }

  for (let i = 0; i < replayed.uci.length; i++) {
    const pos = replayed.positions[i];
    const next = replayed.positions[i + 1];
    const color = pos.turn;
    const lines = (evals[i] && evals[i].lines) || [];
    const afterLines = (evals[i + 1] && evals[i + 1].lines) || [];
    const best = lines[0];
    const afterBest = afterLines[0];
    const bestScore = best && (best.kind === 'mate' || best.kind === 'cp') ? best : { kind: 'cp', value: best ? toCp(best) : 0 };
    const afterScore = afterBest && (afterBest.kind === 'mate' || afterBest.kind === 'cp') ? afterBest : { kind: 'cp', value: afterBest ? toCp(afterBest) : 0 };
    const playedScore = invertScore(afterScore);
    const bestCp = toCp(bestScore);
    const playedCp = toCp(playedScore);
    const playedUci = replayed.uci[i];
    const isBestMove = !!(best && best.move && best.move === playedUci);
    const legalCount = pos.legalMoves().length;
    const playedMove = pos.parseUci(playedUci);
    const isSacrifice = isPieceSacrifice(pos, next, playedMove, {
      candidates: lines.map((l) => l && l.move).filter(Boolean),
    });
    const isBook = replayed.startFen === START_FEN && lastBookPly >= i + 1;
    const opponentBlundered = i > 0 && FLAGGED.includes(moves[i - 1].judgment);
    const secondScore = lines[1] && (lines[1].kind === 'mate' || lines[1].kind === 'cp') ? lines[1] : (lines[1] ? { kind: 'cp', value: toCp(lines[1]) } : null);
    const prevDest = i > 0 ? uciSquares(replayed.uci[i - 1]) : null;
    const isRecapture = !!(playedMove && playedMove.captured && prevDest && prevDest.to === playedMove.to);
    const cls = classifyMove({
      bestScore, playedScore, bestCp, playedCp, isBestMove, legalCount,
      secondScore, isBook, isSacrifice, opponentBlundered, isRecapture,
    });
    const bestUci = (best && best.move) || null;
    let bestSan = null;
    if (bestUci) {
      const bm = pos.parseUci(bestUci);
      if (bm) bestSan = pos.toSan(bm);
    }
    const bestLine = lineFromPv(pos, best, 12);
    const playedLine = lineFromPv(next, afterBest, 12);
    const suggestionUci = bestUci && bestUci !== playedUci ? bestUci : null;
    let threatUci = null;
    let threatSan = null;
    if (afterBest && afterBest.move) {
      const tm = next.parseUci(afterBest.move);
      const flagged = FLAGGED.includes(cls.judgment);
      if (tm && (flagged || threatIsMeaningful(next, afterBest, playedMove))) {
        threatUci = afterBest.move;
        threatSan = next.toSan(tm);
      }
    }
    const user = isUserMove(mode, playerColor, color);
    const row = {
      ply: i + 1,
      san: sans[i],
      uci: playedUci,
      color,
      bestUci,
      bestSan,
      secondUci: lines[1] && lines[1].move ? lines[1].move : null,
      evalBefore: { kind: bestScore.kind, value: bestScore.value, cp: bestCp, whiteCp: whiteCpFrom(bestScore, color) },
      evalAfter: { kind: afterScore.kind, value: afterScore.value, cp: playedCp, whiteCp: whiteCpFrom(afterScore, next.turn) },
      winBefore: cls.winBefore,
      winAfter: cls.winAfter,
      loss: cls.loss,
      epLoss: cls.epLoss,
      accuracy: cls.accuracy,
      judgment: cls.judgment,
      forced: cls.forced,
      isPlayer: user,
      legalCount,
      topCp: bestCp,
      secondCp: lines[1] ? toCp(lines[1]) : null,
      isBook,
      isSacrifice,
      bestLine,
      playedLine,
      suggestionUci,
      threatUci,
      threatSan,
    };
    moves.push(row);
    counts[color][cls.judgment]++;
    if (user) {
      counts.player[cls.judgment]++;
      if (MISTAKE_JUDGMENTS.includes(cls.judgment) && passesMistakeMarginRules(lines)) {
        mistakes.push({
          fen: pos.toFen(),
          solution: [bestUci],
          playedUci,
          playedSan: sans[i],
          bestSan,
          judgment: cls.judgment,
          ply: i + 1,
          color,
          topCp: bestCp,
          secondCp: row.secondCp,
        });
      }
    }
  }

  const positions = replayed.positions.map((p, i) => {
    const ev = evals[i] || { lines: [] };
    const top = ev.lines && ev.lines[0];
    const score = top && (top.kind === 'mate' || top.kind === 'cp') ? top : { kind: 'cp', value: top ? toCp(top) : 0 };
    return {
      fen: p.toFen(),
      turn: p.turn,
      whiteCp: top ? whiteCpFrom(score, p.turn) : 0,
      winPercent: top ? winPercent(whiteLichessCp(score, p.turn)) : 50,
      best: top ? top.move : null,
    };
  });

  const startTurn = replayed.positions[0].turn;
  const acc = gameAccuracy(startTurn, positions.map((p) => p.winPercent));
  const userColor = mode === 'bot' ? (playerColor === 'b' ? 'b' : 'w') : null;
  const playerAcc = userColor ? acc[userColor] : (acc.w != null && acc.b != null ? (acc.w + acc.b) / 2 : acc.w ?? acc.b);

  return {
    version: SCHEME_VERSION,
    scheme: SCHEME_ID,
    depth,
    startFen: replayed.startFen,
    uci: replayed.uci,
    sans,
    mode,
    playerColor: userColor,
    name: name || '',
    gameId: gameId || null,
    analyzedAt: 0,
    moves,
    positions,
    accuracy: {
      w: acc.w,
      b: acc.b,
      player: playerAcc,
    },
    counts,
    mistakes,
  };
}

/** Fingerprint used as the review cache key. */
export function reviewFingerprint(startFen, uci, depth = REVIEW_DEPTH) {
  const raw = `${startFen || START_FEN}|${(uci || []).join(' ')}|d${depth}|v${SCHEME_VERSION}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function isFlagged(judgment) {
  return FLAGGED.includes(judgment);
}

export function emptyJudgmentCounts() {
  return emptyCounts();
}

/**
 * Structural check of a stored My mistakes puzzle: the FEN must parse and
 * every solution move must be legal. Does not call the engine.
 */
export function inspectMistakePuzzle(p) {
  if (!p || typeof p !== 'object' || typeof p.fen !== 'string' || !Array.isArray(p.solution) || !p.solution[0]) {
    return { ok: false, reason: 'invalid', legal: false };
  }
  let pos;
  try { pos = Position.fromFen(p.fen); } catch { return { ok: false, reason: 'invalid-fen', legal: false }; }
  let cur = pos;
  const solution = [];
  for (const u of p.solution) {
    if (typeof u !== 'string') return { ok: false, reason: 'illegal-solution', legal: false };
    const m = cur.parseUci(u);
    if (!m) return { ok: false, reason: 'illegal-solution', legal: false };
    solution.push(u);
    cur = cur.makeMove(m);
  }
  return { ok: true, reason: '', legal: true, pos, solution };
}

/**
 * Re-verify a My mistakes puzzle with an engine. The first move must be the
 * unique best move at DEEP_DEPTH (16), after a depth-12 screen. A second
 * mating first move is rejected even if it is slower.
 */
export async function verifyMistakePuzzle(p, engine, opts = {}) {
  const inspected = inspectMistakePuzzle(p);
  if (!inspected.ok) return inspected;
  if (!engine || typeof engine.analyse !== 'function') {
    return { ok: false, reason: 'no-engine', legal: true };
  }
  const screen = opts.screenDepth ?? 12;
  const deep = opts.depth ?? 16;
  const fen = inspected.pos.toFen();
  const uci = inspected.solution[0];
  const legal = inspected.pos.legalMoves().length;
  try {
    const quick = await engine.analyse(fen, { depth: screen, multipv: Math.min(2, legal) });
    if (!quick.length || quick[0].move !== uci || !passesMistakeMarginRules(quick)) {
      return { ok: false, reason: 'not-unique', legal: true };
    }
    const an = await engine.analyse(fen, { depth: deep, multipv: Math.min(8, legal) });
    if (!an.length || an[0].move !== uci || !passesMistakeMarginRules(an)) {
      return { ok: false, reason: 'not-unique', legal: true };
    }
    return { ok: true, reason: '', legal: true };
  } catch (err) {
    return { ok: false, reason: 'engine-error', legal: true, error: err && err.message ? err.message : String(err) };
  }
}

export const MISTAKE_SCREEN_DEPTH = 12;
export const MISTAKE_DEEP_DEPTH = 16;
