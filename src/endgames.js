/**
 * Endgame practice sessions. Pure ES module (no DOM), so Node tests can import it.
 * Success and failure are decided from engine.js Game results, material
 * checks, and an optional Stockfish evaluation. The application does not
 * call a tablebase at runtime. See NOTES-endgames.md for the criteria.
 */
import { Position, Game } from './engine.js';
import { ENDGAMES, ENDGAME_CATEGORIES, endgameById } from './data/endgames.js';

export { ENDGAMES, ENDGAME_CATEGORIES, endgameById };

const SIDES = new Set(['w', 'b']);
const GOALS = new Set(['win', 'draw']);
const SUCCESS_TYPES = new Set(['mate', 'promote', 'draw']);

/** Parse a FEN and throw if it is not a legal position for engine.js. */
export function parseEndgameFen(fen) {
  return Position.fromFen(fen);
}

/**
 * Check that a catalog entry has the required fields and a legal FEN.
 * Returns the parsed Position. Throws a readable Error otherwise.
 */
export function validateEndgame(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('The endgame entry is missing.');
  if (typeof entry.id !== 'string' || !entry.id) throw new Error('The endgame entry needs an id.');
  if (typeof entry.title !== 'string' || !entry.title) throw new Error(`The endgame "${entry.id}" needs a title.`);
  if (typeof entry.fen !== 'string') throw new Error(`The endgame "${entry.id}" needs a FEN string.`);
  if (!SIDES.has(entry.playerColor)) throw new Error(`The endgame "${entry.id}" needs a playerColour of "w" or "b".`);
  if (!GOALS.has(entry.goal)) throw new Error(`The endgame "${entry.id}" needs a goal of "win" or "draw".`);
  const success = entry.success || {};
  if (!SUCCESS_TYPES.has(success.type)) throw new Error(`The endgame "${entry.id}" needs a success type of mate, promote or draw.`);
  if (entry.goal === 'win' && success.type === 'draw') throw new Error(`The endgame "${entry.id}" cannot have a win goal with a draw success type.`);
  if (entry.goal === 'draw' && success.type !== 'draw') throw new Error(`The endgame "${entry.id}" cannot have a draw goal with a ${success.type} success type.`);
  if (success.type === 'draw' && success.holdPlies != null && !(Number.isInteger(success.holdPlies) && success.holdPlies > 0)) {
    throw new Error(`The endgame "${entry.id}" has an invalid holdPlies value.`);
  }
  let pos;
  try { pos = Position.fromFen(entry.fen); } catch (err) {
    throw new Error(`The endgame "${entry.id}" has an illegal FEN. ${err.message}`);
  }
  if (entry.theory && (entry.theory.result === 'win' || entry.theory.result === 'draw') && entry.theory.result !== entry.goal) {
    throw new Error(`The endgame "${entry.id}" states a ${entry.goal} goal, but the recorded theory result is ${entry.theory.result}.`);
  }
  return pos;
}

/**
 * Confirm that each idea move is legal from the starting FEN, in order.
 * Returns the list of move objects. Throws if a move cannot be played.
 */
export function ideaLine(entry) {
  const pos0 = validateEndgame(entry);
  const moves = Array.isArray(entry.ideaMoves) ? entry.ideaMoves : [];
  const out = [];
  let pos = pos0;
  for (let i = 0; i < moves.length; i++) {
    const u = moves[i];
    const m = typeof u === 'string' ? pos.parseUci(u) : u;
    if (!m) throw new Error(`The endgame "${entry.id}" has an illegal idea move "${u}" at ply ${i + 1}.`);
    out.push(m);
    pos = pos.makeMove(m);
  }
  return out;
}

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** A position is treated as lost for the defender when the engine's score for that side is at most this, in centipawns. */
export const EVAL_LOST_CP = -200;
/** A promoted position is treated as a clear win when the engine's score for the player is at least this, in centipawns. */
export const EVAL_WIN_CP = 300;

function emptyCounts() {
  return { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
}

/** Count the pieces of one colour on a position. */
export function pieceCounts(pos, color) {
  const out = emptyCounts();
  if (!pos) return out;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.pieceAt(sq);
    if (p && p.color === color && out[p.type] != null) out[p.type] += 1;
  }
  return out;
}

function materialValue(counts) {
  let n = 0;
  for (const t of ['p', 'n', 'b', 'r', 'q']) n += (counts[t] || 0) * PIECE_VALUE[t];
  return n;
}

/**
 * True when the last move was a pawn promotion by the player named in the entry.
 * The colour and pawn checks are required; a promotion by the other side must not count.
 */
export function isPlayerPromotion(game, entry, lastMove) {
  return !!(lastMove && lastMove.promotion && lastMove.piece === 'p' && justMovedColor(game) === entry.playerColor);
}

/** True when the opponent has no legal capture of the newly promoted piece. */
export function promotedPieceIsSafe(game, lastMove) {
  if (!lastMove || lastMove.to == null) return false;
  const pos = game.position;
  return !pos.legalMoves().some((m) => m.to === lastMove.to);
}

/**
 * True when the player's material after a promotion is a clear win: an
 * advantage of at least a queen, or a queen against at most one minor piece
 * (for example king and queen against king and knight).
 */
export function promotionMaterialIsWinning(game, playerColor) {
  const pos = game.position;
  const me = pieceCounts(pos, playerColor);
  const opp = pieceCounts(pos, playerColor === 'w' ? 'b' : 'w');
  const edge = materialValue(me) - materialValue(opp);
  if (edge >= PIECE_VALUE.q - 1) return true;
  if (me.q >= 1 && opp.q === 0 && opp.r === 0 && opp.p === 0 && (opp.n + opp.b) <= 1) return true;
  return false;
}

/** True when the only pieces left are two kings, or two kings and one pawn. */
export function isKingAndPawnOrBareKings(pos) {
  const w = pieceCounts(pos, 'w');
  const b = pieceCounts(pos, 'b');
  const total = (c) => c.p + c.n + c.b + c.r + c.q;
  if (w.k !== 1 || b.k !== 1) return false;
  const extras = total(w) + total(b);
  const pawns = w.p + b.p;
  return extras === 0 || (extras === 1 && pawns === 1);
}

/**
 * True when the defender still has the material that makes the intended drawing
 * method possible, and the attacker has not gained a new queen by promotion.
 * Used as the offline check because the application cannot query a tablebase.
 */
export function holdMaterialIntact(game, entry) {
  let start;
  try { start = Position.fromFen(entry.fen); } catch { return false; }
  const now = game.position;
  const me = entry.playerColor;
  const opp = me === 'w' ? 'b' : 'w';
  const sMe = pieceCounts(start, me);
  const nMe = pieceCounts(now, me);
  const sOpp = pieceCounts(start, opp);
  const nOpp = pieceCounts(now, opp);
  // The defender must keep a rook or queen they started with (a rook may be
  // replaced only by a queen). If they started with a pawn, they must still
  // have a pawn or a promoted piece.
  // A rook or queen trade that leaves only kings, or king and pawn versus
  // king, is not treated as a collapse. Those endings are often drawn (the
  // defending king in front of the pawn, or inside the square of the pawn),
  // and the engine decides if the defence is actually lost. Any other loss of
  // the drawing piece still fails the hold.
  const reducedToKp = isKingAndPawnOrBareKings(now);
  if (sMe.r > 0 && nMe.r + nMe.q < sMe.r && !reducedToKp) return false;
  if (sMe.q > 0 && nMe.q < sMe.q && !reducedToKp) return false;
  if (sMe.p > 0 && (nMe.p + nMe.q + nMe.r + nMe.n + nMe.b) === 0 && !reducedToKp) return false;
  // A new queen for the attacker, from a pawn, is treated as an unstoppable win.
  if (nOpp.q > sOpp.q) return false;
  return true;
}

/**
 * Convert Stockfish analyse() lines into a centipawn score for `side`.
 * A mate for the side to move is stored as a large positive number.
 */
export function scoreForSide(lines, sideToMove, side) {
  const top = lines && lines[0];
  if (!top) return null;
  let cp;
  if (top.kind === 'mate') {
    const n = top.value;
    if (!n) cp = 0;
    else cp = (n > 0 ? 1 : -1) * (10000 - Math.min(Math.abs(n), 9999));
  } else if (top.kind === 'cp' && Number.isFinite(top.value)) {
    cp = top.value;
  } else {
    return null;
  }
  return side === sideToMove ? cp : -cp;
}

/**
 * Refine a sync judgment with an engine evaluation. A draw goal fails as
 * soon as the defender's score is clearly lost. A promotion is accepted only
 * when the player's score is decisively winning.
 */
export function applyEngineEval(game, entry, lastMove, lines) {
  const ev = evaluatePosition(game, entry, lastMove);
  const score = scoreForSide(lines, game.position.turn, entry.playerColor);
  if (score == null) return ev;
  if (entry.goal === 'draw' && (ev.status === 'in-progress' || ev.reason === 'hold' || ev.reason === 'collapsed')) {
    if (score <= EVAL_LOST_CP) return { status: 'failure', reason: 'lost' };
    // A collapsed flag on a king-and-pawn ending is withdrawn when the
    // engine does not see a clear loss, so a drawn rook trade is not failed.
    if (ev.reason === 'collapsed' && isKingAndPawnOrBareKings(game.position)) {
      const success = entry.success || {};
      if (success.holdPlies && game.moves.length >= success.holdPlies) {
        return { status: 'success', reason: 'hold' };
      }
      return { status: 'in-progress', reason: null };
    }
  }
  const safePromotion = entry.goal === 'win' && isPlayerPromotion(game, entry, lastMove) && promotedPieceIsSafe(game, lastMove);
  if (safePromotion && (ev.reason === 'promotion' || ev.status === 'in-progress')) {
    if (score >= EVAL_WIN_CP) return { status: 'success', reason: 'promotion' };
    if (ev.reason === 'promotion') {
      if (score <= EVAL_LOST_CP) return { status: 'failure', reason: 'promotion-not-winning' };
      return { status: 'in-progress', reason: null };
    }
  }
  return ev;
}

/**
 * Withdraw a promotion or hold success that still needed an engine
 * confirmation. Used when the engine call throws, so the session stays in
 * progress instead of keeping an unconfirmed success.
 */
export function revertUnconfirmedEval(session) {
  if (!session) return { status: null, reason: null };
  if (session.status === 'success' && (session.reason === 'hold' || session.reason === 'promotion')) {
    session.status = 'in-progress';
    session.reason = null;
  }
  return { status: session.status, reason: session.reason };
}

function playerWon(result, playerColor) {
  if (!result) return false;
  if (result.result === '1/2-1/2') return false;
  return (result.result === '1-0') === (playerColor === 'w');
}

function isDraw(result) {
  return !!(result && result.result === '1/2-1/2');
}

function justMovedColor(game) {
  const n = game.positions.length;
  if (n < 2) return null;
  return game.positions[n - 2].turn;
}


/**
 * True when the defender can recapture on the square just taken and the
 * resulting position is king versus king, or king and pawn versus king.
 * This lets a rook trade that leads to a drawn pawn ending finish before
 * the hold is failed as collapsed.
 */
export function canRecaptureIntoPawnEnding(game, entry, lastMove) {
  if (!lastMove || lastMove.to == null || !lastMove.captured) return false;
  const pos = game.position;
  if (pos.turn !== entry.playerColor) return false;
  for (const m of pos.legalMoves()) {
    if (m.to !== lastMove.to) continue;
    const next = pos.makeMove(m);
    if (isKingAndPawnOrBareKings(next)) return true;
  }
  return false;
}

/**
 * Decide the session status after a legal move has been played.
 * Returns { status: 'in-progress'|'success'|'failure', reason }.
 */
export function evaluatePosition(game, entry, lastMove = null) {
  const playerColor = entry.playerColor;
  const goal = entry.goal;
  const success = entry.success || {};
  const result = game.result();

  if (result) {
    if (playerWon(result, playerColor) && (goal === 'win' || goal === 'draw')) {
      return { status: 'success', reason: result.reason };
    }
    if (isDraw(result) && goal === 'draw') {
      return { status: 'success', reason: result.reason };
    }
    if (isDraw(result) && goal === 'win') {
      return { status: 'failure', reason: result.reason };
    }
    if (!isDraw(result) && !playerWon(result, playerColor)) {
      return { status: 'failure', reason: result.reason };
    }
  }

  if (success.type === 'promote' && isPlayerPromotion(game, entry, lastMove)
      && promotedPieceIsSafe(game, lastMove) && promotionMaterialIsWinning(game, playerColor)) {
    return { status: 'success', reason: 'promotion' };
  }

  if (goal === 'draw') {
    if (!holdMaterialIntact(game, entry)) {
      if (canRecaptureIntoPawnEnding(game, entry, lastMove)) {
        return { status: 'in-progress', reason: null };
      }
      return { status: 'failure', reason: 'collapsed' };
    }
    if (success.holdPlies && game.moves.length >= success.holdPlies) {
      return { status: 'success', reason: 'hold' };
    }
  }

  return { status: 'in-progress', reason: null };
}

export function reasonText(reason, { goal, status } = {}) {
  const texts = {
    checkmate: status === 'success' ? 'Checkmate. You have completed this position.' : 'You were checkmated. This practice was not completed.',
    stalemate: goal === 'draw' ? 'The game is drawn by stalemate. You have completed this position.' : 'The game is drawn by stalemate. This position is a win, so the practice was not completed.',
    threefold: goal === 'draw' ? 'The game is drawn by threefold repetition. You have completed this position.' : 'The game is drawn by threefold repetition. This position is a win, so the practice was not completed.',
    'fifty-move': goal === 'draw' ? 'The game is drawn by the fifty-move rule. You have completed this position.' : 'The game is drawn by the fifty-move rule. This position is a win, so the practice was not completed.',
    insufficient: goal === 'draw' ? 'The game is drawn by insufficient material. You have completed this position.' : 'The game is drawn by insufficient material. This position is a win, so the practice was not completed.',
    promotion: 'The pawn has been promoted to a position that is clearly winning. You have completed this position.',
    hold: 'You have held a sound defence for the required number of moves. You have completed this position.',
    collapsed: 'The material that was needed to hold the draw has been lost. This practice was not completed.',
    lost: 'The position is now a loss with accurate play. This practice was not completed.',
    'promotion-not-winning': 'The pawn was promoted, but the resulting position is not a clear win. This practice was not completed.',
    resignation: status === 'success' ? 'The opposing side resigned. You have completed this position.' : 'The game ended by resignation. This practice was not completed.',
    timeout: status === 'success' ? 'The opposing side lost on time. You have completed this position.' : 'The game ended on time. This practice was not completed.',
    agreement: 'The game is drawn by agreement. You have completed this position.',
  };
  return texts[reason] || (status === 'success' ? 'You have completed this position.' : status === 'failure' ? 'This practice was not completed.' : '');
}

/** Interactive solver for one catalog position. */
export class EndgameSession {
  constructor(entry) {
    this.entry = entry;
    validateEndgame(entry);
    this.reset();
  }

  reset() {
    this.game = new Game(this.entry.fen);
    this.status = 'in-progress';
    this.reason = null;
    this.usedHint = false;
    this.playerColor = this.entry.playerColor;
  }

  get position() { return this.game.position; }
  get playerToMove() { return this.status === 'in-progress' && this.game.position.turn === this.playerColor; }
  engineToMove() { return this.status === 'in-progress' && this.game.position.turn !== this.playerColor; }

  /**
   * Play a move (a move object or a UCI string). Returns
   * { ok, status, reason, move } when the move is legal.
   */
  play(move) {
    if (this.status !== 'in-progress') return { ok: false, status: this.status, reason: this.reason, move: null };
    const pos = this.game.position;
    const m = typeof move === 'string' ? pos.parseUci(move) : move;
    if (!m || !this.game.play(m)) return { ok: false, status: this.status, reason: this.reason, move: null };
    const ev = evaluatePosition(this.game, this.entry, m);
    this.status = ev.status;
    this.reason = ev.reason;
    return { ok: true, status: this.status, reason: this.reason, move: m };
  }

  /**
   * Apply a Stockfish analysis of the current position to refine the
   * judgment after play(). Returns the updated { status, reason }.
   */
  applyEval(lines) {
    const last = this.game.lastMove || this.game.moves[this.game.moves.length - 1] || null;
    const ev = applyEngineEval(this.game, this.entry, last, lines);
    this.status = ev.status;
    this.reason = ev.reason;
    return ev;
  }

  /** See revertUnconfirmedEval. */
  revertUnconfirmedEval() {
    return revertUnconfirmedEval(this);
  }

  hintMove() {
    let line = [];
    try { line = ideaLine(this.entry); } catch { return null; }
    if (!line.length) return null;
    if (this.game.moves.length === 0) return line[0];
    if (this.game.moves.length < line.length) {
      const same = this.game.moves.every((played, i) => {
        const idea = line[i];
        return idea && played.from === idea.from && played.to === idea.to && (played.promotion || '') === (idea.promotion || '');
      });
      if (same) return line[this.game.moves.length] || null;
    }
    return line[0];
  }
}
