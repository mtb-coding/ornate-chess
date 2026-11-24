// Per-key progress sync. Last write wins on updatedAt. Deletes are tombstones.
import { HttpError } from './errors.mjs';

export const SYNC_KEYS = new Set([
  'games',
  'stats',
  'puzzle-progress',
  'player-rating',
  'endgame-progress',
  'reviews-index',
  'mistake-puzzles',
  'gen-pool-v2',
  'gen-stats',
]);

const REVIEW_KEY = /^review:[a-z0-9]{1,16}$/;
const MAX_VALUE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 80;
const MAX_GAMES = 50;
const MAX_REVIEWS = 30;
const MAX_MISTAKES = 200;
const MAX_FUTURE_MS = 5 * 60 * 1000;

export function isSyncKey(key) {
  return SYNC_KEYS.has(key) || REVIEW_KEY.test(key);
}

function checkValue(key, value) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > MAX_VALUE_BYTES) {
    throw new HttpError(400, `The value for ${key} is larger than 1 MB.`);
  }
  if (key === 'games') {
    if (!Array.isArray(value)) throw new HttpError(400, 'Saved games must be an array.');
    if (value.length > MAX_GAMES) throw new HttpError(400, 'A sync cannot keep more than 50 saved games.');
  }
  if (key === 'mistake-puzzles' && value && typeof value === 'object' && Array.isArray(value.puzzles) && value.puzzles.length > MAX_MISTAKES) {
    throw new HttpError(400, 'A sync cannot keep more than 200 mistake puzzles.');
  }
  return encoded;
}

export function getSync(db, userId) {
  const rows = db.prepare(
    'SELECT key, value_json, updated_at, deleted FROM sync_entries WHERE user_id = ? ORDER BY key',
  ).all(userId);
  return {
    entries: rows.map((row) => ({
      key: row.key,
      value: row.deleted || row.value_json == null ? null : JSON.parse(row.value_json),
      updatedAt: row.updated_at,
      deleted: row.deleted === 1,
    })),
  };
}

export function putSync(db, userId, entries, now = Date.now()) {
  if (!Array.isArray(entries)) throw new HttpError(400, 'entries must be an array.');
  if (entries.length > MAX_ENTRIES) throw new HttpError(400, 'That sync request has too many entries.');
  const seen = new Set();
  const normalized = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new HttpError(400, 'Each entry must be an object.');
    const key = entry.key;
    if (typeof key !== 'string' || !isSyncKey(key)) {
      throw new HttpError(400, `The key ${JSON.stringify(key)} cannot be synced.`);
    }
    if (seen.has(key)) throw new HttpError(400, `The key ${key} is repeated.`);
    seen.add(key);
    if (!Number.isInteger(entry.updatedAt) || entry.updatedAt < 0 || entry.updatedAt > now + MAX_FUTURE_MS) {
      throw new HttpError(400, `The key ${key} has an invalid updatedAt.`);
    }
    const deleted = entry.deleted === true;
    let valueJson = null;
    if (!deleted) {
      if (!Object.prototype.hasOwnProperty.call(entry, 'value')) {
        throw new HttpError(400, `The key ${key} is missing a value.`);
      }
      valueJson = checkValue(key, entry.value);
    }
    normalized.push({ key, updatedAt: entry.updatedAt, deleted, valueJson });
  }

  const existingReviews = db.prepare(
    "SELECT key, deleted FROM sync_entries WHERE user_id = ? AND key LIKE 'review:%'",
  ).all(userId);
  const liveReviews = new Set(existingReviews.filter((row) => row.deleted !== 1).map((row) => row.key));
  for (const entry of normalized) {
    if (!entry.key.startsWith('review:')) continue;
    if (entry.deleted) liveReviews.delete(entry.key);
    else liveReviews.add(entry.key);
  }
  if (liveReviews.size > MAX_REVIEWS) {
    throw new HttpError(400, 'A sync cannot keep more than 30 reviews.');
  }

  const current = db.prepare('SELECT updated_at FROM sync_entries WHERE user_id = ? AND key = ?');
  const upsert = db.prepare(`
    INSERT INTO sync_entries (user_id, key, value_json, updated_at, deleted)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of normalized) {
      const row = current.get(userId, entry.key);
      if (row && row.updated_at >= entry.updatedAt) continue;
      upsert.run(userId, entry.key, entry.deleted ? null : entry.valueJson, entry.updatedAt, entry.deleted ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
