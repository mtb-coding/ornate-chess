// Position editor state. No DOM. The analysis board plays moves; this module
// only builds a FEN the rules engine will accept.
import { Position, START_FEN, squareName } from './engine.js';

const CASTLE_HOME = {
  wK: { king: 4, rook: 7, color: 'w' },
  wQ: { king: 4, rook: 0, color: 'w' },
  bK: { king: 60, rook: 63, color: 'b' },
  bQ: { king: 60, rook: 56, color: 'b' },
};

export const CASTLE_KEYS = ['wK', 'wQ', 'bK', 'bQ'];

function piece(color, type) { return { color, type }; }

function copy(state) {
  return {
    squares: state.squares.map((p) => (p ? piece(p.color, p.type) : null)),
    side: state.side === 'b' ? 'b' : 'w',
    castle: {
      wK: !!state.castle.wK, wQ: !!state.castle.wQ, bK: !!state.castle.bK, bQ: !!state.castle.bQ,
    },
    ep: Number.isInteger(state.ep) ? state.ep : null,
    halfmove: Number.isInteger(state.halfmove) && state.halfmove >= 0 ? state.halfmove : 0,
    fullmove: Number.isInteger(state.fullmove) && state.fullmove >= 1 ? state.fullmove : 1,
  };
}

/** True when that king and rook both stand on the squares castling requires. */
export function castleAvailable(squares, key) {
  const home = CASTLE_HOME[key];
  if (!home) return false;
  const king = squares[home.king];
  const rook = squares[home.rook];
  return !!(king && king.color === home.color && king.type === 'k'
    && rook && rook.color === home.color && rook.type === 'r');
}

/**
 * Every square a pawn could have just passed, whoever is to move.
 * `side` is the side that would be allowed to capture.
 */
export function epCandidates(state) {
  const squares = state.squares;
  const out = [];
  for (let file = 0; file < 8; file++) {
    const blackPassed = 40 + file;
    const blackPawn = squares[blackPassed - 8];
    if (blackPawn && blackPawn.color === 'b' && blackPawn.type === 'p'
      && !squares[blackPassed] && !squares[blackPassed + 8]) {
      out.push({ sq: blackPassed, side: 'w' });
    }
    const whitePassed = 16 + file;
    const whitePawn = squares[whitePassed + 8];
    if (whitePawn && whitePawn.color === 'w' && whitePawn.type === 'p'
      && !squares[whitePassed] && !squares[whitePassed - 8]) {
      out.push({ sq: whitePassed, side: 'b' });
    }
  }
  return out;
}

/** Squares where an en passant capture is legal for the side to move. */
export function epSquares(state) {
  return epCandidates(state).filter((c) => c.side === (state.side === 'b' ? 'b' : 'w')).map((c) => c.sq);
}

/** The square a pawn just passed, when this move is a two-step from its starting rank. */
function passedSquare(moving, from, to, squares) {
  if (!moving || moving.type !== 'p' || (from & 7) !== (to & 7)) return null;
  const fromRank = from >> 3;
  const toRank = to >> 3;
  if (moving.color === 'w' && fromRank === 1 && toRank === 3 && !squares[from + 8]) {
    return { sq: from + 8, side: 'b' };
  }
  if (moving.color === 'b' && fromRank === 6 && toRank === 4 && !squares[from - 8]) {
    return { sq: from - 8, side: 'w' };
  }
  return null;
}

function settle(state) {
  const next = copy(state);
  for (const key of CASTLE_KEYS) if (!castleAvailable(next.squares, key)) next.castle[key] = false;
  if (next.ep != null && !epCandidates(next).some((c) => c.sq === next.ep)) next.ep = null;
  return next;
}

export function emptySetup() {
  return settle({
    squares: Array(64).fill(null),
    side: 'w',
    castle: { wK: false, wQ: false, bK: false, bQ: false },
    ep: null,
    halfmove: 0,
    fullmove: 1,
  });
}

export function setupFromFen(fen) {
  const pos = Position.fromFen(fen);
  const squares = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.pieceAt(sq);
    squares.push(p ? piece(p.color, p.type) : null);
  }
  return settle({
    squares,
    side: pos.turn,
    castle: pos.castling,
    ep: pos.epSquare,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
  });
}

export function startSetup() { return setupFromFen(START_FEN); }

export function placePiece(state, sq, nextPiece) {
  const next = copy(state);
  next.squares[sq] = nextPiece ? piece(nextPiece.color, nextPiece.type) : null;
  return settle(next);
}

export function moveSetupPiece(state, from, to) {
  if (from === to) return copy(state);
  const next = copy(state);
  const moving = next.squares[from];
  next.squares[to] = moving;
  next.squares[from] = null;
  const passed = passedSquare(moving, from, to, next.squares);
  if (passed) next.ep = passed.sq;
  return settle(next);
}

export function setSetupSide(state, side) {
  const next = copy(state);
  next.side = side === 'b' ? 'b' : 'w';
  return settle(next);
}

export function setSetupCastle(state, key, on) {
  if (!CASTLE_KEYS.includes(key) || !castleAvailable(state.squares, key)) return copy(state);
  const next = copy(state);
  next.castle[key] = !!on;
  return next;
}

export function setSetupEp(state, sq) {
  const next = copy(state);
  if (sq == null) {
    next.ep = null;
    return next;
  }
  if (!epCandidates(next).some((c) => c.sq === sq)) return next;
  next.ep = sq;
  return next;
}

export function setupFen(state) {
  const settled = settle(state);
  let out = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = settled.squares[rank * 8 + file];
      if (!p) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      const ch = p.type;
      out += p.color === 'w' ? ch.toUpperCase() : ch;
    }
    if (empty) out += empty;
    if (rank) out += '/';
  }
  const castle = (settled.castle.wK ? 'K' : '') + (settled.castle.wQ ? 'Q' : '')
    + (settled.castle.bK ? 'k' : '') + (settled.castle.bQ ? 'q' : '');
  const ep = settled.ep != null && epSquares(settled).includes(settled.ep) ? squareName(settled.ep) : '-';
  return `${out} ${settled.side} ${castle || '-'} ${ep} ${settled.halfmove} ${settled.fullmove}`;
}

/** Sentences that explain why Analyze should stay disabled. Empty when the position can be played. */
export function setupProblems(state) {
  try {
    Position.fromFen(setupFen(state));
    return [];
  } catch (err) {
    const msg = String(err && err.message || '');
    if (msg.includes('pawns')) return ['Pawns cannot stand on the first or last rank.'];
    if (msg.includes('king')) return ['Each side must have exactly one king.'];
    if (msg.includes('check')) return ['The side that is not to move is in check. Choose the other side to move, or change the pieces.'];
    return [msg.replace(/^Invalid FEN:\s*/, '') || 'This position cannot be played.'];
  }
}
