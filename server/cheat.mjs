// Engine-agreement check for finished online games, and the three pace lists.
// A single careful game is not enough. Two marked games in one pace leave
// that player off that pace's list. The rating itself is not changed.
// Move times can support a mark. An appeal clears marks that the times do not support.
import { randomUUID } from 'node:crypto';
import { PROVISIONAL_DEVIATION } from '../src/glicko.js';
import { PACES } from '../src/online-ratings.js';
import { HttpError } from './errors.mjs';

export const CHEAT_MIN_MOVES = 15;
export const CHEAT_MATCH_RATE = 0.9;
export const CHEAT_MAX_AVERAGE_LOSS = 2;
export const CHEAT_HIDE_AFTER = 2;
export const CHEAT_FAST_SHARE = 0.8;
export const APPEAL_NOTE_MAX = 400;
const LIST_LIMIT = 100;

const ACTIVE_FLAGS = 'cleared_at IS NULL';

/** Think-time cap, in milliseconds, for the pace of a starting clock. */
export function instantCapMs(baseMs) {
  const base = Number(baseMs);
  if (!Number.isFinite(base) || base <= 0) return 2000;
  return Math.max(400, Math.min(2000, Math.round(base / 120)));
}

function consideredMoves(moves, color) {
  return (moves || []).map((move, index) => ({ move, index })).filter(({ move }) => move
    && move.color === color
    && !move.isBook
    && !move.forced
    && move.legalCount > 1
    && move.bestUci);
}

/** Moves outside the opening, with a real choice, compared with the engine's first move. */
export function assessColor(moves, color) {
  const considered = consideredMoves(moves, color).map(({ move }) => move);
  const matches = considered.filter((move) => move.uci === move.bestUci).length;
  const averageLoss = considered.length
    ? considered.reduce((sum, move) => sum + (Number(move.loss) || 0), 0) / considered.length
    : null;
  const flagged = considered.length >= CHEAT_MIN_MOVES
    && matches / considered.length >= CHEAT_MATCH_RATE
    && averageLoss != null
    && averageLoss <= CHEAT_MAX_AVERAGE_LOSS;
  return { color, moves: considered.length, matches, averageLoss, flagged };
}

/**
 * True when the considered moves were also played at a steady, very fast pace.
 * Missing times do not support a mark. The cap scales with the starting clock.
 */
export function timingSupports(moves, color, times, baseMs) {
  const capMs = instantCapMs(baseMs);
  const timed = consideredMoves(moves, color).map(({ index }) => {
    const ms = times ? Number(times[index]) : NaN;
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }).filter((ms) => ms != null);
  if (timed.length < CHEAT_MIN_MOVES) return { supported: false, medianMs: null, timed: timed.length };
  const sorted = [...timed].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const under = timed.filter((ms) => ms <= capMs).length;
  return {
    supported: medianMs <= capMs && under / timed.length >= CHEAT_FAST_SHARE,
    medianMs,
    timed: timed.length,
  };
}

export function recordCheatFlags(db, { gameId, whiteId, blackId, pace, moves, times = [], baseMs = 0, now = Date.now() } = {}) {
  if (!PACES.includes(pace)) return { flags: 0 };
  const reports = ['w', 'b'].map((color) => {
    const assessed = assessColor(moves, color);
    const timing = timingSupports(moves, color, times, baseMs);
    return {
      userId: color === 'w' ? whiteId : blackId,
      ...assessed,
      timingSupported: assessed.flagged && timing.supported,
      medianMs: timing.medianMs,
    };
  });
  db.exec('BEGIN IMMEDIATE');
  try {
    let flags = 0;
    const priorStmt = db.prepare('SELECT cleared_at FROM cheat_flags WHERE game_id = ? AND user_id = ?');
    const remove = db.prepare('DELETE FROM cheat_flags WHERE game_id = ? AND user_id = ?');
    const insert = db.prepare(`INSERT INTO cheat_flags (
      game_id, user_id, pace, color, moves, matches, average_loss, created_at,
      timing_supported, median_ms, cleared_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const report of reports) {
      if (!report.userId) continue;
      const prior = priorStmt.get(gameId, report.userId);
      remove.run(gameId, report.userId);
      if (!report.flagged) continue;
      const clearedAt = prior && prior.cleared_at ? prior.cleared_at : null;
      insert.run(
        gameId,
        report.userId,
        pace,
        report.color,
        report.moves,
        report.matches,
        report.averageLoss,
        now,
        report.timingSupported ? 1 : 0,
        report.medianMs,
        clearedAt,
      );
      if (!clearedAt) flags += 1;
    }
    db.exec('COMMIT');
    return { flags };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function activeFlags(db, userId, pace) {
  return db.prepare(`SELECT game_id, timing_supported, created_at FROM cheat_flags
    WHERE user_id = ? AND pace = ? AND ${ACTIVE_FLAGS}`).all(userId, pace);
}

function latestAppeal(db, userId, pace) {
  return db.prepare(`SELECT status, decision, created_at AS at FROM appeals
    WHERE user_id = ? AND pace = ? ORDER BY created_at DESC LIMIT 1`).get(userId, pace) || null;
}

function appealAllowed(flags, appeal) {
  if (flags.length < CHEAT_HIDE_AFTER) return false;
  if (!appeal || appeal.status !== 'declined') return true;
  return flags.some((flag) => flag.created_at > appeal.at);
}

export function submitAppeal(db, { userId, pace, note, now = Date.now() } = {}) {
  if (!PACES.includes(pace)) throw new HttpError(400, 'Choose bullet, blitz or rapid.');
  const text = typeof note === 'string' ? note.trim() : '';
  if (text.length > APPEAL_NOTE_MAX) throw new HttpError(400, 'The note must be 400 characters or fewer.');
  const flags = activeFlags(db, userId, pace);
  const appeal = latestAppeal(db, userId, pace);
  if (flags.length < CHEAT_HIDE_AFTER) throw new HttpError(400, 'Two marked games are needed before an appeal.');
  if (!appealAllowed(flags, appeal)) {
    throw new HttpError(400, 'That appeal was already declined. A new marked game is needed before another appeal.');
  }
  const supported = flags.filter((flag) => flag.timing_supported).length;
  const accepted = supported < CHEAT_HIDE_AFTER;
  const status = accepted ? 'accepted' : 'declined';
  const decision = accepted
    ? 'The appeal was accepted. Games that were not played at a steady, very fast pace no longer keep you off the list. The rating is unchanged.'
    : 'The appeal was declined. Two games in this category matched the engine very closely and were played at a steady, very fast pace. The rating is unchanged.';
  db.exec('BEGIN IMMEDIATE');
  try {
    if (accepted) {
      db.prepare(`UPDATE cheat_flags SET cleared_at = ?
        WHERE user_id = ? AND pace = ? AND ${ACTIVE_FLAGS} AND timing_supported = 0`).run(now, userId, pace);
    }
    db.prepare(`INSERT INTO appeals (id, user_id, pace, note, status, decision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), userId, pace, text, status, decision, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { status, decision, at: now };
}

function eligibleSql() {
  return `pr.deviation <= ${PROVISIONAL_DEVIATION}
    AND (
      SELECT COUNT(*) FROM cheat_flags f
      WHERE f.user_id = pr.user_id AND f.pace = pr.pace AND f.cleared_at IS NULL
    ) < ${CHEAT_HIDE_AFTER}`;
}

export function leaderboard(db, pace, userId = null) {
  if (!PACES.includes(pace)) throw new HttpError(400, 'Choose bullet, blitz or rapid.');
  const rows = db.prepare(`
    SELECT u.username, pr.rating, pr.games, pr.wins, pr.draws, pr.losses
    FROM pace_ratings pr
    JOIN users u ON u.id = pr.user_id
    WHERE pr.pace = ? AND ${eligibleSql()}
    ORDER BY pr.rating DESC, u.username COLLATE NOCASE
    LIMIT ${LIST_LIMIT}
  `).all(pace);
  const players = rows.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    rating: Math.round(row.rating),
    games: row.games,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
  }));
  let you = null;
  if (userId) {
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    const mine = db.prepare('SELECT rating, deviation, games FROM pace_ratings WHERE user_id = ? AND pace = ?').get(userId, pace);
    const flags = activeFlags(db, userId, pace);
    const appeal = latestAppeal(db, userId, pace);
    const held = flags.length >= CHEAT_HIDE_AFTER;
    const stable = !!(mine && mine.deviation <= PROVISIONAL_DEVIATION);
    let rank = null;
    if (user && stable && !held) {
      const ahead = db.prepare(`
        SELECT COUNT(*) AS n
        FROM pace_ratings pr
        WHERE pr.pace = ? AND pr.rating > ? AND ${eligibleSql()}
      `).get(pace, mine.rating);
      rank = (ahead ? ahead.n : 0) + 1;
    }
    you = {
      username: user ? user.username : '',
      held,
      provisional: !stable,
      rank,
      rating: stable ? Math.round(mine.rating) : null,
      games: mine ? mine.games : 0,
      canAppeal: appealAllowed(flags, appeal),
      appeal: appeal ? { status: appeal.status, decision: appeal.decision, at: appeal.at } : null,
    };
  }
  return { pace, players, you };
}
