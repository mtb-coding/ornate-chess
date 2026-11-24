// Low-priority background work. The API only queues jobs. server/worker.mjs runs them.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Game } from '../src/engine.js';

export const JOB_KINDS = ['backup', 'review'];
const MAX_ATTEMPTS = 3;
const STALE_MS = 10 * 60 * 1000;

export function enqueueJob(db, { kind, payload = {}, now = Date.now(), runAfter = now } = {}) {
  if (!JOB_KINDS.includes(kind)) throw new Error('That background job is not known.');
  const payloadJson = JSON.stringify(payload);
  const blocking = kind === 'review' ? ['queued', 'running', 'done'] : ['queued', 'running'];
  const existing = db.prepare(
    `SELECT id FROM jobs WHERE kind = ? AND payload_json = ? AND status IN (${blocking.map(() => '?').join(', ')})`,
  ).get(kind, payloadJson, ...blocking);
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare(`INSERT INTO jobs (
    id, kind, payload_json, status, attempts, run_after, last_error, result_json, created_at, updated_at
  ) VALUES (?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?)`).run(id, kind, payloadJson, runAfter, now, now);
  return id;
}

export function claimJob(db, now = Date.now()) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running' AND updated_at < ?`)
      .run(now, now - STALE_MS);
    const row = db.prepare(
      `SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY created_at LIMIT 1`,
    ).get(now);
    if (!row) {
      db.exec('COMMIT');
      return null;
    }
    db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`)
      .run(now, row.id);
    db.exec('COMMIT');
    return { ...row, attempts: row.attempts + 1, status: 'running' };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function finishJob(db, id, result, now = Date.now()) {
  db.prepare(`UPDATE jobs SET status = 'done', result_json = ?, last_error = NULL, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(result ?? null), now, id);
}

export function failJob(db, id, error, now = Date.now()) {
  const row = db.prepare('SELECT attempts FROM jobs WHERE id = ?').get(id);
  const message = error && error.message ? error.message : String(error);
  const again = row && row.attempts < MAX_ATTEMPTS;
  db.prepare(`UPDATE jobs SET status = ?, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?`)
    .run(again ? 'queued' : 'failed', message, again ? now + 30_000 : now, now, id);
  return again ? 'queued' : 'failed';
}

export function ensureBackup(db, now = Date.now()) {
  const day = 24 * 60 * 60 * 1000;
  const recent = db.prepare(`SELECT id FROM jobs WHERE kind = 'backup' AND created_at > ?`).get(now - day);
  if (recent) return recent.id;
  return enqueueJob(db, { kind: 'backup', payload: {}, now });
}

/** Consistent snapshot of the open database. Older copies beyond keep are removed. */
export function runBackup(db, { directory, now = Date.now(), keep = 7 } = {}) {
  if (!directory) throw new Error('A backup needs a directory.');
  fs.mkdirSync(directory, { recursive: true });
  const dest = path.join(directory, `ornate-${now}.sqlite`);
  const sqlPath = dest.replaceAll('\\', '/').replaceAll("'", "''");
  db.exec(`VACUUM INTO '${sqlPath}'`);
  const kept = fs.readdirSync(directory)
    .filter((name) => /^ornate-\d+\.sqlite$/.test(name))
    .sort();
  for (const name of kept.slice(0, Math.max(0, kept.length - keep))) {
    fs.rmSync(path.join(directory, name), { force: true });
  }
  return { file: dest, bytes: fs.statSync(dest).size };
}

/** One deep line on the final position of a stored live game. */
export async function runReview(db, job, { analyse } = {}) {
  const payload = JSON.parse(job.payload_json);
  const row = db.prepare('SELECT game_json FROM live_games WHERE id = ?').get(payload.gameId);
  if (!row) throw new Error('That finished game is no longer stored.');
  const game = Game.fromJSON(JSON.parse(row.game_json));
  const fen = game.fen();
  if (!analyse) throw new Error('No engine is available for this review.');
  const line = await analyse(fen);
  return { gameId: payload.gameId, fen, ply: game.length, line };
}
