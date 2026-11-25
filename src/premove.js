// Premoves are chosen while the opponent is to move. A queued move plays
// later only if it is legal in the position that actually arises. The preview
// lets a piece step onto a square it could reach, including a square that
// currently holds a friendly piece, so a recapture can be queued before the
// capture happens. A sliding piece stops on the first piece in its path.

export const PREMOVE_LIMIT = 5;
export const PREMOVE_MS = 100;

const KNIGHT = [[1, 2], [2, 1], [-1, 2], [2, -1], [1, -2], [-2, 1], [-1, -2], [-2, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function fileOf(sq) { return sq & 7; }
function rankOf(sq) { return sq >> 3; }
function squareAt(file, rank) { return rank * 8 + file; }
function onBoard(file, rank) { return file >= 0 && file < 8 && rank >= 0 && rank < 8; }

export function parsePremoveUci(uci) {
  if (typeof uci !== 'string') return null;
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!match) return null;
  const fromFile = match[1].charCodeAt(0) - 97;
  const fromRank = match[1].charCodeAt(1) - 49;
  const toFile = match[2].charCodeAt(0) - 97;
  const toRank = match[2].charCodeAt(1) - 49;
  if (!onBoard(fromFile, fromRank) || !onBoard(toFile, toRank)) return null;
  return {
    from: squareAt(fromFile, fromRank),
    to: squareAt(toFile, toRank),
    promotion: match[3] || '',
  };
}

export function pieceBoard(position) {
  return position.board.map((piece) => (piece ? { color: piece.color, type: piece.type } : null));
}

/** Squares a premove from `from` may use. The square itself is never included. */
export function premoveDestinations(board, color, from) {
  const piece = board[from];
  if (!piece || piece.color !== color || from < 0 || from > 63) return [];
  const found = [];
  const seen = new Set();
  const add = (file, rank) => {
    if (!onBoard(file, rank)) return;
    const to = squareAt(file, rank);
    if (to === from || seen.has(to)) return;
    seen.add(to);
    found.push(to);
  };
  const ray = (dirs) => {
    const file = fileOf(from);
    const rank = rankOf(from);
    for (const [df, dr] of dirs) {
      let nextFile = file + df;
      let nextRank = rank + dr;
      while (onBoard(nextFile, nextRank)) {
        add(nextFile, nextRank);
        if (board[squareAt(nextFile, nextRank)]) break;
        nextFile += df;
        nextRank += dr;
      }
    }
  };
  if (piece.type === 'n') {
    const file = fileOf(from);
    const rank = rankOf(from);
    for (const [df, dr] of KNIGHT) add(file + df, rank + dr);
  } else if (piece.type === 'k') {
    const file = fileOf(from);
    const rank = rankOf(from);
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) if (df || dr) add(file + df, rank + dr);
    }
    const home = color === 'w' ? 0 : 7;
    if (rank === home && file === 4) {
      const queenside = board[squareAt(0, home)];
      const kingside = board[squareAt(7, home)];
      if (queenside && queenside.type === 'r' && queenside.color === color) add(2, home);
      if (kingside && kingside.type === 'r' && kingside.color === color) add(6, home);
    }
  } else if (piece.type === 'b') ray(BISHOP);
  else if (piece.type === 'r') ray(ROOK);
  else if (piece.type === 'q') ray([...BISHOP, ...ROOK]);
  else if (piece.type === 'p') {
    const dir = color === 'w' ? 1 : -1;
    const file = fileOf(from);
    const rank = rankOf(from);
    const start = color === 'w' ? 1 : 6;
    add(file, rank + dir);
    if (rank === start) add(file, rank + 2 * dir);
    add(file - 1, rank + dir);
    add(file + 1, rank + dir);
  }
  return found;
}

export function premoveMoves(board, color, from) {
  const piece = board[from];
  if (!piece || piece.color !== color) return [];
  const last = color === 'w' ? 7 : 0;
  const moves = [];
  for (const to of premoveDestinations(board, color, from)) {
    if (piece.type === 'p' && rankOf(to) === last) {
      for (const promotion of ['q', 'r', 'b', 'n']) {
        moves.push({ from, to, piece: 'p', color, promotion, flags: 'p' });
      }
    } else moves.push({ from, to, piece: piece.type, color, promotion: '', flags: '' });
  }
  return moves;
}

/** Move one queued piece on a preview board. Returns false when the move cannot be shown. */
export function applyPremoveBoard(board, color, uci) {
  const parsed = typeof uci === 'string' ? parsePremoveUci(uci) : uci;
  if (!parsed) return false;
  const piece = board[parsed.from];
  if (!piece || piece.color !== color) return false;
  if (!premoveDestinations(board, color, parsed.from).includes(parsed.to)) return false;
  const last = color === 'w' ? 7 : 0;
  const promoting = piece.type === 'p' && rankOf(parsed.to) === last;
  if (promoting && !parsed.promotion) return false;
  if (!promoting && parsed.promotion) return false;
  if (piece.type === 'k' && Math.abs(fileOf(parsed.to) - fileOf(parsed.from)) === 2) {
    const home = rankOf(parsed.from);
    const kingside = fileOf(parsed.to) === 6;
    const rookFrom = squareAt(kingside ? 7 : 0, home);
    const rookTo = squareAt(kingside ? 5 : 3, home);
    const rook = board[rookFrom];
    if (!rook || rook.type !== 'r' || rook.color !== color) return false;
    board[parsed.from] = null;
    board[rookFrom] = null;
    board[parsed.to] = { color, type: 'k' };
    board[rookTo] = { color, type: 'r' };
    return true;
  }
  if (piece.type === 'p' && fileOf(parsed.to) !== fileOf(parsed.from) && !board[parsed.to]) {
    const beside = squareAt(fileOf(parsed.to), rankOf(parsed.from));
    const victim = board[beside];
    if (victim && victim.type === 'p' && victim.color !== color) board[beside] = null;
  }
  board[parsed.from] = null;
  board[parsed.to] = { color, type: promoting ? parsed.promotion : piece.type };
  return true;
}

export function previewPremoves(position, color, ucis) {
  const board = pieceBoard(position);
  const marks = [];
  for (const uci of ucis) {
    const parsed = parsePremoveUci(uci);
    if (!parsed || !applyPremoveBoard(board, color, parsed)) break;
    marks.push(parsed.from, parsed.to);
  }
  return { board, marks };
}

/** True when `uci` can be appended to the preview built from `ucis`. */
export function premoveAllowed(position, color, ucis, uci) {
  if (!Array.isArray(ucis) || ucis.length >= PREMOVE_LIMIT) return false;
  const board = pieceBoard(position);
  for (const prev of ucis) if (!applyPremoveBoard(board, color, prev)) return false;
  const trial = board.map((piece) => (piece ? { color: piece.color, type: piece.type } : null));
  return applyPremoveBoard(trial, color, uci);
}
