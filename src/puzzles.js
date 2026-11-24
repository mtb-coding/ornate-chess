/**
 * Ornate Chess — puzzle session runner and selection.
 */

import { Position } from './engine.js';
import { PUZZLES } from './data/puzzles.js';

export { PUZZLES };

const THEMES = new Set([
  'mate-in-1',
  'mate-in-2',
  'mate-in-3',
  'mate-in-4',
  'fork',
  'pin',
  'skewer',
  'back-rank',
  'discovered',
  'sacrifice',
  'endgame',
  'promotion',
  'deflection',
  'zugzwang-ish',
]);

/**
 * Parse FEN side-to-move.
 * @param {string} fen
 */
function sideToMove(fen) {
  const parts = fen.trim().split(/\s+/);
  return parts[1] === 'b' ? 'b' : 'w';
}

function uciEqual(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function moveToUci(move) {
  if (!move) return null;
  if (typeof move === 'string') return move.toLowerCase();
  const files = 'abcdefgh';
  const from = files[move.from % 8] + (1 + Math.floor(move.from / 8));
  const to = files[move.to % 8] + (1 + Math.floor(move.to / 8));
  const promo = move.promotion ? String(move.promotion).toLowerCase() : '';
  return from + to + promo;
}

/**
 * Does playing `uci` (and then following the scripted replies / best forced line)
 * still deliver mate in `N` player moves for the side to move?
 * For mate themes, any first move that forces mate in N is accepted.
 */
function isMatingAlternative(startFen, playedUci, mateInN) {
  let pos = Position.fromFen(startFen);
  const first = pos.parseUci(playedUci);
  if (!first) return false;
  pos = pos.makeMove(first);
  // After our move, if mate-in-1, opponent must be checkmated now.
  if (mateInN === 1) return pos.isCheckmate();

  // For mate-in-2/3 we require that every opponent reply still allows us to force mate
  // within the remaining player moves. This is a shallow forced-mate check.
  return forcesMate(pos, mateInN - 1);
}

/**
 * Side to move can force checkmate in exactly `playerMoves` of their turns
 * (i.e. mate-in-N). Returns true if there exists at least one move leading to
 * forced mate in N. Uses brute-force legal-move search (fine for shallow N).
 */
function forcesMate(pos, playerMoves) {
  if (playerMoves <= 0) return false;
  if (pos.isCheckmate()) return false;
  const moves = pos.legalMoves();
  for (const m of moves) {
    const child = pos.makeMove(m);
    if (playerMoves === 1) {
      if (child.isCheckmate()) return true;
      continue;
    }
    // Opponent replies: all must be mateable in playerMoves-1
    if (child.isCheckmate()) return true; // faster mate is acceptable
    if (child.isStalemate()) continue;
    const replies = child.legalMoves();
    if (replies.length === 0) continue;
    let allRepliesMate = true;
    for (const r of replies) {
      const after = child.makeMove(r);
      if (!forcesMate(after, playerMoves - 1)) {
        allRepliesMate = false;
        break;
      }
    }
    if (allRepliesMate) return true;
  }
  return false;
}

function mateThemeN(theme) {
  if (theme === 'mate-in-1') return 1;
  if (theme === 'mate-in-2') return 2;
  if (theme === 'mate-in-3') return 3;
  if (theme === 'mate-in-4') return 4;
  return 0;
}

/**
 * Interactive solver for one puzzle.
 */
export class PuzzleSession {
  /**
   * @param {object} puzzle — entry from PUZZLES
   */
  constructor(puzzle) {
    if (!puzzle || typeof puzzle !== 'object') throw new Error('PuzzleSession requires a puzzle object.');
    if (typeof puzzle.fen !== 'string') throw new Error('Puzzle is missing fen.');
    if (!Array.isArray(puzzle.solution) || puzzle.solution.length === 0) {
      throw new Error('Puzzle is missing solution moves.');
    }
    this.puzzle = puzzle;
    this.playerColor = sideToMove(puzzle.fen);
    this._hintStage = 0;
    this.reset();
  }

  reset() {
    this.position = Position.fromFen(this.puzzle.fen);
    this._ply = 0; // index into solution: even = player, odd = reply
    this._hintStage = 0;
    this._complete = false;
    this._wrong = false;
  }

  /**
   * Staged hints: 1) from-square, 2) from+to of the next solution move.
   * @returns {{from:number, to?:number}}
   */
  hint() {
    if (this._complete || this._wrong) {
      const uci = this.puzzle.solution[this._ply] || this.puzzle.solution[0];
      const m = this.position.parseUci(uci) || Position.fromFen(this.puzzle.fen).parseUci(this.puzzle.solution[0]);
      return m ? { from: m.from, to: m.to } : { from: 0 };
    }
    const expectedUci = this.puzzle.solution[this._ply];
    const move = this.position.parseUci(expectedUci);
    if (!move) return { from: 0 };
    this._hintStage += 1;
    if (this._hintStage === 1) return { from: move.from };
    return { from: move.from, to: move.to };
  }

  /**
   * Attempt a player move (move object or UCI string).
   * @returns {{status:'correct'|'complete'|'wrong', reply?: object}}
   */
  tryMove(move) {
    if (this._complete) return { status: 'complete' };
    if (this._wrong) return { status: 'wrong' };

    const uci = moveToUci(typeof move === 'string' ? move : move);
    // Normalize: if move object passed, prefer engine UCI
    let playedUci = uci;
    let playedMove = null;
    if (typeof move === 'string') {
      playedMove = this.position.parseUci(move);
      playedUci = move.toLowerCase();
    } else if (move && typeof move === 'object') {
      playedMove = move;
      playedUci = this.position.moveToUci ? this.position.moveToUci(move) : moveToUci(move);
    }
    if (!playedMove) {
      playedMove = this.position.parseUci(playedUci);
    }
    if (!playedMove) {
      this._wrong = true;
      return { status: 'wrong' };
    }

    // Must be legal in current position
    const legal = this.position.legalMoves().some(
      (m) => m.from === playedMove.from && m.to === playedMove.to && (m.promotion || '') === (playedMove.promotion || '')
    );
    if (!legal) {
      // try matching via parse
      const rematch = this.position.parseUci(playedUci);
      if (!rematch) {
        this._wrong = true;
        return { status: 'wrong' };
      }
      playedMove = rematch;
      playedUci = this.position.moveToUci(rematch);
    }

    const expectedUci = String(this.puzzle.solution[this._ply]).toLowerCase();
    const mateN = mateThemeN(this.puzzle.theme);
    let accept = uciEqual(playedUci, expectedUci);

    // Mate puzzles: accept any move that also forces mate in N from the start of THIS ply
    // (for the first player move of the puzzle, N = theme; for later player plies, remaining mates).
    if (!accept && mateN > 0 && this._ply % 2 === 0) {
      const remaining = mateN - Math.floor(this._ply / 2);
      const fenNow = this.position.toFen();
      if (remaining === 1) {
        const nxt = this.position.makeMove(playedMove);
        accept = nxt.isCheckmate();
      } else if (remaining > 1) {
        accept = isMatingAlternative(fenNow, playedUci, remaining);
      }
    }

    // Also accept listed alternatives if present
    if (!accept && Array.isArray(this.puzzle.alternatives)) {
      const alt = this.puzzle.alternatives[this._ply];
      if (Array.isArray(alt) && alt.some((u) => uciEqual(u, playedUci))) accept = true;
    }

    if (!accept) {
      this._wrong = true;
      return { status: 'wrong' };
    }

    this.position = this.position.makeMove(playedMove);
    this._ply += 1;
    this._hintStage = 0;

    // Completed if no more player moves in solution, or checkmate reached
    const morePlayerMoves = this._ply < this.puzzle.solution.length;
    if (this.position.isCheckmate() || !morePlayerMoves) {
      this._complete = true;
      return { status: 'complete' };
    }

    // Apply scripted opponent reply if present
    if (this._ply < this.puzzle.solution.length) {
      const replyUci = this.puzzle.solution[this._ply];
      const reply = this.position.parseUci(replyUci);
      if (!reply) {
        // Solution broken — treat as complete if we already mated, else wrong line data
        if (this.position.isCheckmate()) {
          this._complete = true;
          return { status: 'complete' };
        }
        this._wrong = true;
        return { status: 'wrong' };
      }
      this.position = this.position.makeMove(reply);
      this._ply += 1;

      if (this._ply >= this.puzzle.solution.length) {
        this._complete = true;
        return { status: 'complete', reply };
      }
      return { status: 'correct', reply };
    }

    this._complete = true;
    return { status: 'complete' };
  }
}

/**
 * Choose the next unsolved puzzle near the user's rating.
 * @param {{rating?: number, puzzles?: Record<string,{solved?:boolean}>}} progress
 * @param {{theme?: string, difficulty?: number, includeSolved?: boolean}} [filter]
 */
export function nextPuzzle(progress, filter = {}) {
  const rating = typeof progress?.rating === 'number' ? progress.rating : 1200;
  const solvedMap = progress?.puzzles || {};
  let pool = PUZZLES.slice();

  if (filter.theme) {
    if (!THEMES.has(filter.theme) && filter.theme !== 'all') {
      pool = pool.filter((p) => p.theme === filter.theme);
    } else if (filter.theme !== 'all') {
      pool = pool.filter((p) => p.theme === filter.theme);
    }
  }
  if (typeof filter.difficulty === 'number') {
    pool = pool.filter((p) => p.difficulty === filter.difficulty);
  }
  if (!filter.includeSolved) {
    pool = pool.filter((p) => !solvedMap[p.id]?.solved);
  }
  if (pool.length === 0) {
    // Fall back to any matching filter including solved
    pool = PUZZLES.slice();
    if (filter.theme && filter.theme !== 'all') pool = pool.filter((p) => p.theme === filter.theme);
    if (typeof filter.difficulty === 'number') pool = pool.filter((p) => p.difficulty === filter.difficulty);
  }
  if (pool.length === 0) return null;

  // Prefer puzzles whose rating is near the user rating (±150), then expand.
  const scored = pool.map((p) => ({
    p,
    dist: Math.abs((p.rating || 1200) - rating),
  }));
  scored.sort((a, b) => a.dist - b.dist || a.p.difficulty - b.p.difficulty);
  // Pick among the closest few for variety
  const band = scored.filter((s) => s.dist <= Math.max(150, scored[0].dist));
  const pick = band[Math.floor(Math.random() * band.length)] || scored[0];
  return pick.p;
}

/**
 * Validate a puzzle object against the engine (used by tests and generator).
 * @returns {{ok:boolean, errors:string[]}}
 */
export function verifyPuzzle(puzzle) {
  const errors = [];
  if (!puzzle?.id) errors.push('missing id');
  if (!puzzle?.fen) errors.push('missing fen');
  if (!Array.isArray(puzzle?.solution) || puzzle.solution.length === 0) errors.push('missing solution');
  if (!THEMES.has(puzzle?.theme)) errors.push(`invalid theme ${puzzle?.theme}`);
  if (!(puzzle?.difficulty >= 1 && puzzle?.difficulty <= 5)) errors.push('difficulty must be 1..5');

  let pos;
  try {
    pos = Position.fromFen(puzzle.fen);
  } catch (e) {
    errors.push(`invalid fen: ${e.message}`);
    return { ok: false, errors };
  }

  for (let i = 0; i < puzzle.solution.length; i++) {
    const uci = puzzle.solution[i];
    const m = pos.parseUci(uci);
    if (!m) {
      errors.push(`solution[${i}] ${uci} is illegal in ${pos.toFen()}`);
      break;
    }
    pos = pos.makeMove(m);
  }

  const n = mateThemeN(puzzle.theme);
  if (n > 0 && errors.length === 0) {
    if (!pos.isCheckmate()) {
      errors.push(`mate-in-${n} solution does not end in checkmate`);
    } else {
      // Player moves in solution should be exactly n (solution length = n + (n-1) replies = 2n-1)
      const playerMoves = Math.ceil(puzzle.solution.length / 2);
      if (playerMoves !== n) {
        errors.push(`mate-in-${n} expected ${n} player moves, found ${playerMoves}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
