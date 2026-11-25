// Stored reviews of finished online games, and the mistake puzzles taken from them.
import { randomUUID } from 'node:crypto';
import { inspectMistakePuzzle } from '../src/review.js';
import { HttpError } from './errors.mjs';

function puzzleBody(mistake, gameName, gameId) {
  return {
    fen: mistake.fen,
    solution: mistake.solution,
    playedUci: mistake.playedUci,
    playedSan: mistake.playedSan || '',
    bestSan: mistake.bestSan || '',
    judgment: mistake.judgment,
    ply: mistake.ply,
    color: mistake.color,
    gameName: gameName || '',
    gameId,
  };
}

function puzzleView(row) {
  const body = JSON.parse(row.puzzle_json);
  return {
    id: row.id,
    gameId: row.game_id,
    fen: body.fen,
    solution: body.solution,
    playedUci: body.playedUci || '',
    playedSan: body.playedSan || '',
    bestSan: body.bestSan || '',
    judgment: body.judgment || '',
    ply: body.ply,
    color: body.color,
    gameName: body.gameName || '',
    solved: row.solved === 1,
    attempts: row.attempts,
    usedHint: row.used_hint === 1,
    createdAt: row.created_at,
  };
}

/**
 * Replace the stored review for a game and keep one puzzle per player move.
 * A later review does not clear a puzzle the player has already solved or removed.
 */
export function saveGameReview(db, { gameId, whiteId, blackId, review, now = Date.now() } = {}) {
  if (!gameId || !review) throw new Error('A review needs a game.');
  const insert = db.prepare(`INSERT INTO game_puzzles (
    id, game_id, user_id, color, ply, puzzle_json, solved, attempts, used_hint, removed, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
  ON CONFLICT(game_id, user_id, ply) DO UPDATE SET
    color = excluded.color,
    puzzle_json = excluded.puzzle_json,
    updated_at = excluded.updated_at`);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO game_reviews (game_id, depth, review_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(game_id) DO UPDATE SET
        depth = excluded.depth,
        review_json = excluded.review_json`).run(gameId, review.depth || 0, JSON.stringify(review), now);
    let puzzles = 0;
    for (const mistake of review.mistakes || []) {
      if (!inspectMistakePuzzle(mistake).ok) continue;
      const userId = mistake.color === 'b' ? blackId : whiteId;
      if (!userId) continue;
      insert.run(
        randomUUID(),
        gameId,
        userId,
        mistake.color,
        mistake.ply,
        JSON.stringify(puzzleBody(mistake, review.name, gameId)),
        now,
        now,
      );
      puzzles += 1;
    }
    db.exec('COMMIT');
    return { puzzles };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function readGameReview(db, gameId, userId) {
  const game = db.prepare('SELECT white_id, black_id FROM live_games WHERE id = ?').get(gameId);
  if (!game) throw new HttpError(404, 'That game is not stored.');
  if (game.white_id !== userId && game.black_id !== userId) {
    throw new HttpError(403, 'That game belongs to another player.');
  }
  const row = db.prepare('SELECT review_json, created_at FROM game_reviews WHERE game_id = ?').get(gameId);
  if (!row) return { pending: true, review: null };
  return { pending: false, createdAt: row.created_at, review: JSON.parse(row.review_json) };
}

export function listGamePuzzles(db, userId) {
  const rows = db.prepare(`SELECT id, game_id, puzzle_json, solved, attempts, used_hint, created_at
    FROM game_puzzles
    WHERE user_id = ? AND removed = 0
    ORDER BY created_at DESC
    LIMIT 100`).all(userId);
  return rows.map(puzzleView);
}

export function updateGamePuzzle(db, userId, id, body, now = Date.now()) {
  const row = db.prepare(`SELECT id, game_id, puzzle_json, solved, attempts, used_hint, removed, created_at
    FROM game_puzzles WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row || row.removed === 1) throw new HttpError(404, 'That position is not in your list.');
  const solved = typeof body.solved === 'boolean' ? (body.solved ? 1 : 0) : row.solved;
  const attempts = Number.isInteger(body.attempts) && body.attempts >= 0 && body.attempts <= 10000
    ? body.attempts
    : row.attempts;
  const usedHint = typeof body.usedHint === 'boolean' ? (body.usedHint ? 1 : 0) : row.used_hint;
  const removed = body.removed === true ? 1 : row.removed;
  db.prepare(`UPDATE game_puzzles
    SET solved = ?, attempts = ?, used_hint = ?, removed = ?, updated_at = ?
    WHERE id = ?`).run(solved, attempts, usedHint, removed, now, id);
  return puzzleView({ ...row, solved, attempts, used_hint: usedHint, created_at: row.created_at });
}
