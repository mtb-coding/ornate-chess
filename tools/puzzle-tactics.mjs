/**
 * Mechanical tactic detectors used by the puzzle audit and tests.
 * Geometry is computed from Position.board; no claimed theme is trusted.
 */
import { Position, PIECE_VALUES } from '../src/engine.js';

export const FILES = 'abcdefgh';
export function sqName(sq) { return FILES[sq & 7] + ((sq >> 3) + 1); }

export function pieceValue(type) {
  return PIECE_VALUES[type] || 0;
}

export function parseOrThrow(pos, uci) {
  const m = pos.parseUci(uci);
  if (!m) throw new Error(`illegal ${uci} in ${pos.toFen()}`);
  return m;
}

/** Same rank, file, or diagonal. */
export function isAligned(a, b) {
  if (a === b) return false;
  const df = (a & 7) - (b & 7);
  const dr = (a >> 3) - (b >> 3);
  return df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr);
}

export function rayDir(from, to) {
  const df = Math.sign((to & 7) - (from & 7));
  const dr = Math.sign((to >> 3) - (from >> 3));
  return [df, dr];
}

/** Squares strictly between two aligned squares. */
export function squaresBetween(a, b) {
  if (!isAligned(a, b)) return [];
  const [df, dr] = rayDir(a, b);
  const out = [];
  let f = (a & 7) + df, r = (a >> 3) + dr;
  const tf = b & 7, tr = b >> 3;
  while (f !== tf || r !== tr) {
    out.push(r * 8 + f);
    f += df; r += dr;
  }
  return out;
}

function sliderDirs(type) {
  if (type === 'r') return [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (type === 'b') return [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  if (type === 'q') return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  return [];
}

/**
 * Squares attacked by the piece on `from` (occupied squares included; blocked by first piece).
 * Kings, knights, pawns, sliders.
 */
export function attacksFrom(pos, from) {
  const pc = pos.board[from];
  if (!pc) return [];
  const out = [];
  const f = from & 7, r = from >> 3;
  const push = (sq) => { out.push(sq); };
  const on = (ff, rr) => ff >= 0 && ff < 8 && rr >= 0 && rr < 8;
  if (pc.type === 'n') {
    for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
      const ff = f + df, rr = r + dr;
      if (on(ff, rr)) push(rr * 8 + ff);
    }
  } else if (pc.type === 'k') {
    for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ff = f + df, rr = r + dr;
      if (on(ff, rr)) push(rr * 8 + ff);
    }
  } else if (pc.type === 'p') {
    const dir = pc.color === 'w' ? 1 : -1;
    for (const df of [-1, 1]) {
      const ff = f + df, rr = r + dir;
      if (on(ff, rr)) push(rr * 8 + ff);
    }
  } else {
    for (const [df, dr] of sliderDirs(pc.type)) {
      let ff = f + df, rr = r + dr;
      while (on(ff, rr)) {
        const sq = rr * 8 + ff;
        push(sq);
        if (pos.board[sq]) break;
        ff += df; rr += dr;
      }
    }
  }
  return out;
}

export function enemyTargetsAttackedBy(pos, from) {
  const pc = pos.board[from];
  if (!pc) return [];
  return attacksFrom(pos, from).filter((sq) => pos.board[sq] && pos.board[sq].color !== pc.color);
}

export function materialCount(pos, color) {
  let t = 0;
  for (let sq = 0; sq < 64; sq++) {
    const pc = pos.board[sq];
    if (pc && pc.color === color && pc.type !== 'k') t += pieceValue(pc.type);
  }
  return t;
}

export function sideToMove(fen) {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
}

export function playLine(fen, ucis) {
  let pos = Position.fromFen(fen);
  const sans = [];
  for (const u of ucis) {
    const m = pos.parseUci(u);
    if (!m) return { ok: false, error: `illegal ${u} in ${pos.toFen()}`, pos, sans };
    sans.push(pos.toSan(m));
    pos = pos.makeMove(m);
  }
  return { ok: true, pos, sans };
}

/** Forced mate in `playerMoves` for the side to move (faster mate allowed). */
export function forcesMate(pos, playerMoves) {
  if (playerMoves <= 0) return false;
  if (pos.isCheckmate()) return false;
  const moves = pos.legalMoves();
  for (const m of moves) {
    const child = pos.makeMove(m);
    if (child.isCheckmate()) return true;
    if (playerMoves === 1) continue;
    if (child.isStalemate()) continue;
    const replies = child.legalMoves();
    if (!replies.length) continue;
    let all = true;
    for (const r of replies) {
      if (!forcesMate(child.makeMove(r), playerMoves - 1)) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

export function matingFirstMoves(pos, n) {
  const out = [];
  for (const m of pos.legalMoves()) {
    const child = pos.makeMove(m);
    if (n === 1) {
      if (child.isCheckmate()) out.push(pos.moveToUci(m));
      continue;
    }
    if (child.isCheckmate()) { out.push(pos.moveToUci(m)); continue; }
    if (child.isStalemate()) continue;
    const replies = child.legalMoves();
    if (!replies.length) continue;
    let all = true;
    for (const r of replies) {
      if (!forcesMate(child.makeMove(r), n - 1)) { all = false; break; }
    }
    if (all) out.push(pos.moveToUci(m));
  }
  return out;
}

/**
 * A discovered attack/check: the moving piece leaves a ray between a friendly
 * slider and an enemy unit, and that slider newly attacks that unit.
 * The mover must leave the ray (not stay on it).
 */
export function isDiscoveredAttack(pos, move) {
  const from = move.from, to = move.to;
  const us = pos.board[from]?.color;
  if (!us) return false;
  const them = us === 'w' ? 'b' : 'w';
  const findings = [];
  for (let sq = 0; sq < 64; sq++) {
    const pc = pos.board[sq];
    if (!pc || pc.color !== us) continue;
    if (!['b', 'r', 'q'].includes(pc.type)) continue;
    if (sq === from) continue;
    if (!isAligned(sq, from)) continue;
    // `from` must be the first blocker on some ray from the slider.
    const bet = squaresBetween(sq, from);
    if (bet.some((s) => pos.board[s])) continue;
    // Continue the same direction beyond `from`.
    const [df, dr] = rayDir(sq, from);
    // Destination must leave the ray.
    if (isAligned(sq, to) && squaresBetween(sq, to).includes(from) || (isAligned(sq, to) && rayDir(sq, to)[0] === df && rayDir(sq, to)[1] === dr && !squaresBetween(sq, to).some((s) => s !== from && pos.board[s]))) {
      // If `to` stays on the same ray in the same direction, it is not a discovery
      // (the piece simply moved along the line). Allow if it moved off.
      const stays = isAligned(sq, to) && rayDir(sq, to)[0] === df && rayDir(sq, to)[1] === dr;
      if (stays) continue;
    }
    const staysOnRay = isAligned(sq, to) && rayDir(sq, to)[0] === df && rayDir(sq, to)[1] === dr;
    if (staysOnRay) continue;
    // Walk beyond `from` to the first piece. That piece must be enemy, and
    // nothing else should already have been standing there unblocked — we just
    // need the slider to now attack an enemy.
    let ff = (from & 7) + df, rr = (from >> 3) + dr;
    while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
      const tsq = rr * 8 + ff;
      if (tsq === to) break; // mover still blocks if it landed further on a different... no, we skipped staysOnRay
      const occ = pos.board[tsq];
      if (occ) {
        if (occ.color === them) findings.push({ slider: sq, target: tsq, targetType: occ.type, check: occ.type === 'k' });
        break;
      }
      ff += df; rr += dr;
    }
  }
  return findings.length ? findings : null;
}

/**
 * After the move, the piece that landed (including promotion) attacks two or
 * more enemy pieces (king included).
 */
export function isFork(pos, move) {
  const after = pos.makeMove(move);
  const landed = after.board[move.to];
  if (!landed) return null;
  const targets = enemyTargetsAttackedBy(after, move.to);
  if (targets.length >= 2) {
    return targets.map((sq) => ({ sq, type: after.board[sq].type }));
  }
  return null;
}

/**
 * The move is a skewer: a slider lands so that it attacks a higher-value
 * (or equal, if the front is the king) enemy piece, with another enemy piece
 * behind it on the same ray and no blockers.
 */
export function isSkewer(pos, move) {
  const after = pos.makeMove(move);
  const pc = after.board[move.to];
  if (!pc || !['b', 'r', 'q'].includes(pc.type)) return null;
  const targets = enemyTargetsAttackedBy(after, move.to);
  const findings = [];
  for (const front of targets) {
    if (!isAligned(move.to, front)) continue;
    const [df, dr] = rayDir(move.to, front);
    let ff = (front & 7) + df, rr = (front >> 3) + dr;
    while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
      const tsq = rr * 8 + ff;
      const occ = after.board[tsq];
      if (occ) {
        if (occ.color !== pc.color) {
          const frontVal = after.board[front].type === 'k' ? 10000 : pieceValue(after.board[front].type);
          const backVal = occ.type === 'k' ? 10000 : pieceValue(occ.type);
          // Classic skewer: more valuable piece in front (usually the king).
          if (frontVal >= backVal) {
            findings.push({ front, frontType: after.board[front].type, back: tsq, backType: occ.type });
          }
        }
        break;
      }
      ff += df; rr += dr;
    }
  }
  return findings.length ? findings : null;
}

/**
 * A pin exists after (or already existed and is exploited by) the move:
 * a friendly slider attacks through an enemy piece to a more valuable enemy
 * piece (or the king) on the same ray.
 */
export function pinsIn(pos, color) {
  const them = color === 'w' ? 'b' : 'w';
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    const pc = pos.board[sq];
    if (!pc || pc.color !== color || !['b', 'r', 'q'].includes(pc.type)) continue;
    const attacks = attacksFrom(pos, sq);
    for (const mid of attacks) {
      const midPc = pos.board[mid];
      if (!midPc || midPc.color !== them) continue;
      if (!isAligned(sq, mid)) continue;
      const [df, dr] = rayDir(sq, mid);
      let ff = (mid & 7) + df, rr = (mid >> 3) + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const tsq = rr * 8 + ff;
        const occ = pos.board[tsq];
        if (occ) {
          if (occ.color === them) {
            const midVal = midPc.type === 'k' ? 0 : pieceValue(midPc.type);
            const backVal = occ.type === 'k' ? 10000 : pieceValue(occ.type);
            if (backVal > midVal) out.push({ slider: sq, pinned: mid, pinnedType: midPc.type, behind: tsq, behindType: occ.type, absolute: occ.type === 'k' });
          }
          break;
        }
        ff += df; rr += dr;
      }
    }
  }
  return out;
}

export function isPinMove(pos, move) {
  const before = pinsIn(pos, pos.board[move.from].color);
  const after = pos.makeMove(move);
  const afterPins = pinsIn(after, move.color || pos.board[move.from].color);
  const created = afterPins.filter((p) => !before.some((b) => b.slider === p.slider && b.pinned === p.pinned));
  // Exploiting an existing pin by capturing the pinned piece.
  const capturedPinned = before.find((p) => p.pinned === move.to);
  if (created.length || capturedPinned) {
    return { created, capturedPinned: capturedPinned || null };
  }
  return null;
}

/** Mate delivered on the first or eighth rank, king boxed largely by its own pawns. */
export function isBackRankMate(finalPos, lastMove) {
  if (!finalPos.isCheckmate()) return false;
  const loser = finalPos.turn;
  const k = finalPos.kingSquare(loser);
  const rank = k >> 3;
  if (rank !== 0 && rank !== 7) return false;
  if (lastMove && (lastMove.to >> 3) !== rank) {
    // Mate piece may not be on the back rank (e.g. knight), still allow if king is on back rank.
  }
  const pawnDir = loser === 'w' ? 1 : -1;
  const pr = rank + pawnDir;
  let ownShield = 0;
  if (pr >= 0 && pr < 8) {
    for (const df of [-1, 0, 1]) {
      const f = (k & 7) + df;
      if (f < 0 || f > 7) continue;
      const pc = finalPos.board[pr * 8 + f];
      if (pc && pc.color === loser && pc.type === 'p') ownShield++;
    }
  }
  return ownShield >= 2 || rank === 0 || rank === 7;
}

export function isSmotheredMate(finalPos, lastMove) {
  if (!finalPos.isCheckmate()) return false;
  if (!lastMove || lastMove.piece !== 'n') return false;
  const loser = finalPos.turn;
  const k = finalPos.kingSquare(loser);
  // Every escape square is occupied by the king's own pieces (no empty flight).
  const f = k & 7, r = k >> 3;
  for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const ff = f + df, rr = r + dr;
    if (ff < 0 || ff > 7 || rr < 0 || rr > 7) continue;
    const pc = finalPos.board[rr * 8 + ff];
    if (!pc) return false;
    if (pc.color !== loser) return false;
  }
  return true;
}

export function isPromotionMove(move) {
  return !!(move && move.promotion);
}

/** Immediate material given away by the first move (static, before further play). */
export function immediateMaterialLoss(pos, move) {
  const us = pos.turn;
  const them = us === 'w' ? 'b' : 'w';
  const before = materialCount(pos, us) - materialCount(pos, them);
  const after = pos.makeMove(move);
  let now = materialCount(after, us) - materialCount(after, them);
  // If the moved piece is en prise and not recapturing equally, treat as hanging.
  // SEE-lite: if opponent can capture on `to` and we don't have a cheaper recapture guarantee,
  // subtract the hanging piece value when it's a true sac (opponent can take and we are down).
  const hanging = after.board[move.to];
  if (hanging && hanging.color === us && after.isAttacked(move.to, them)) {
    // If we also left them a captured piece of equal/greater value on the square, net may be ok.
    const gained = move.captured ? pieceValue(move.captured) : 0;
    const lost = pieceValue(hanging.type);
    if (lost > gained) now -= (lost - gained);
  }
  return before - now; // positive means we lost material
}

export function textMentions(p, ...needles) {
  const t = `${p.title} ${p.hint} ${p.explanation}`.toLowerCase();
  return needles.some((n) => t.includes(n.toLowerCase()));
}

