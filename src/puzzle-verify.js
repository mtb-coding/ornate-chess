/**
 * Engine verification of generated puzzles. Pure ES module (no DOM), usable in
 * a worker, in the page and in Node. It checks a candidate puzzle with a real
 * chess engine (Stockfish, supplied by the caller) so that the claims shown to
 * the player are measured with a full evaluation (king safety, mobility,
 * activity), not only with counted material.
 *
 * An engine object has one method:
 *   analyse(fen, { depth, multipv }) -> Promise<Array<{ move, kind, value }>>
 * The array is ordered from best to worst. `move` is a UCI string, `kind` is
 * 'cp' or 'mate', and `value` is from the point of view of the side to move.
 *
 * Rules for a non-mate puzzle, applied at every solver step:
 *   1. The stored solution move is the engine's best move.
 *   2. The best move is clearly winning (at least WIN_CP).
 *   3. The second best move scores at least GAP_CP less, so no other first
 *      move is nearly as good.
 *   4. The second best move does not win by itself. A second move above
 *      ALT_WIN_CP is accepted only when the solution is ALT_MARGIN_CP better,
 *      because scores far above one pawn of advantage differ by noise.
 * Each opponent reply must be among the engine's top choices for the
 * defender. Mate puzzles keep their exact mate-search verification.
 */
import { Position } from './engine.js';

export const WIN_CP = 200;      // the solver must be at least this far ahead after the best move
export const GAP_CP = 200;      // the second best move must be at least this much worse
export const ALT_WIN_CP = 300;  // a second move above this value also wins
export const ALT_MARGIN_CP = 400; // so the solution must beat it by this much
export const SCREEN_DEPTH = 12; // quick first pass
export const DEEP_DEPTH = 16;   // confirmation pass
export const REPLY_DEPTH = 14;  // opponent replies
export const REPLY_TOLERANCE = 60;

/** Centipawn value of an engine score, with forced mates mapped to large values. */
export function toCp(s) {
  if (!s) return -Infinity;
  if (s.kind === 'mate') return (s.value >= 0 ? 1 : -1) * (20000 - Math.abs(s.value));
  return s.value;
}

/** Check the solver steps and replies of `p`. Returns { ok, reason, steps }. */
export async function verifyWithEngine(p, engine, opts = {}) {
  const gap = opts.gap ?? GAP_CP;
  const win = opts.win ?? WIN_CP;
  const altWin = opts.altWin ?? ALT_WIN_CP;
  const altMargin = opts.altMargin ?? ALT_MARGIN_CP;
  const deep = opts.depth ?? DEEP_DEPTH;
  const tolerance = opts.replyTolerance ?? REPLY_TOLERANCE;
  const screen = opts.screenDepth ?? SCREEN_DEPTH;
  const fail = (reason, steps) => ({ ok: false, reason, steps });
  if (p.mateIn) return { ok: true, reason: 'mate puzzles use the exact mate search', steps: [] };
  let pos;
  try { pos = Position.fromFen(p.fen); } catch { return fail('invalid position', []); }
  const steps = [];
  for (let i = 0; i < p.solution.length; i++) {
    const uci = p.solution[i];
    const mv = pos.parseUci(uci);
    if (!mv) return fail(`illegal move ${uci}`, steps);
    if (i % 2 === 0) {
      const legal = pos.legalMoves().length;
      const multipv = Math.min(2, legal);
      // Quick screen: most rejected candidates fail here.
      const quick = await engine.analyse(pos.toFen(), { depth: screen, multipv });
      if (!quick.length || quick[0].move !== uci) return fail(`step ${i / 2 + 1}: the engine prefers another move`, steps);
      if (toCp(quick[0]) < win - 80) return fail(`step ${i / 2 + 1}: the position is not clearly winning`, steps);
      if (quick[1] && toCp(quick[0]) - toCp(quick[1]) < gap - 80) return fail(`step ${i / 2 + 1}: another move is nearly as good`, steps);
      // Confirmation at full depth.
      const an = await engine.analyse(pos.toFen(), { depth: deep, multipv });
      const top = an[0], sec = an[1];
      if (!top || top.move !== uci) return fail(`step ${i / 2 + 1}: the engine prefers another move at depth ${deep}`, steps);
      const topCp = toCp(top);
      if (topCp >= 10000) return fail(`step ${i / 2 + 1}: the engine finds a forced mate`, steps);
      if (topCp < win) return fail(`step ${i / 2 + 1}: the solver is not clearly winning`, steps);
      if (sec && topCp - toCp(sec) < gap) return fail(`step ${i / 2 + 1}: another move is within ${gap} centipawns`, steps);
      if (sec && toCp(sec) > altWin && topCp - toCp(sec) < altMargin) return fail(`step ${i / 2 + 1}: another move also wins`, steps);
      steps.push({ top: topCp, second: sec ? toCp(sec) : null });
    } else {
      const an = await engine.analyse(pos.toFen(), { depth: REPLY_DEPTH, multipv: Math.min(8, pos.legalMoves().length) });
      const best = an[0];
      const mine = an.find((x) => x.move === uci);
      if (!best || !mine || toCp(best) - toCp(mine) > tolerance) return fail(`step ${Math.ceil(i / 2)}: the opponent reply is not a best defence`, steps);
    }
    pos = pos.makeMove(mv);
  }
  return { ok: true, reason: '', steps };
}
