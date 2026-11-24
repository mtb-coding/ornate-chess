// Background job queue: backups, and a review request after a finished game.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { claimJob, enqueueJob, failJob, finishJob, runBackup, runReview } from '../server/jobs.mjs';
import { createLive } from '../server/live.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ornate-jobs-'));
const db = openDatabase(path.join(dir, 'test.sqlite'));
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL ${name}\n  ${err.stack || err.message}`); }
}

function seat(name) {
  const inbox = [];
  return { user: { id: name, username: name }, inbox, send(msg) { inbox.push(msg); } };
}

test('a job is queued once and can be claimed', () => {
  const first = enqueueJob(db, { kind: 'backup', payload: {}, now: 10 });
  const again = enqueueJob(db, { kind: 'backup', payload: {}, now: 11 });
  assert.equal(again, first);
  const job = claimJob(db, 12);
  assert.equal(job.id, first);
  assert.equal(job.status, 'running');
  assert.equal(claimJob(db, 13), null);
  finishJob(db, job.id, { ok: true }, 14);
  const stored = db.prepare('SELECT status, result_json FROM jobs WHERE id = ?').get(job.id);
  assert.equal(stored.status, 'done');
  assert.equal(JSON.parse(stored.result_json).ok, true);
});

test('a failed job is tried again and then kept as failed', () => {
  const id = enqueueJob(db, { kind: 'review', payload: { gameId: 'missing' }, now: 20 });
  const first = claimJob(db, 21);
  assert.equal(failJob(db, first.id, new Error('The engine stopped.'), 22), 'queued');
  const second = claimJob(db, 22 + 30_000);
  assert.equal(second.id, id);
  assert.equal(failJob(db, second.id, new Error('The engine stopped.'), 60_000), 'queued');
  const third = claimJob(db, 90_000);
  assert.equal(failJob(db, third.id, new Error('The engine stopped.'), 90_000), 'failed');
});

test('a backup is a readable copy of the database', () => {
  const backupDir = path.join(dir, 'backups');
  const id = enqueueJob(db, { kind: 'backup', payload: { stamp: 1 }, now: 100 });
  const job = claimJob(db, 101);
  assert.equal(job.id, id);
  const result = runBackup(db, { directory: backupDir, now: 101, keep: 2 });
  finishJob(db, job.id, result, 102);
  assert.ok(result.bytes > 0);
  const copy = openDatabase(result.file);
  const rows = copy.prepare('SELECT COUNT(*) AS n FROM jobs').get();
  assert.ok(rows.n >= 1);
  copy.close();
});

await test('a finished game with a move asks for a deeper review', async () => {
  const live = createLive(db);
  const white = seat('Ada');
  const black = seat('Bea');
  live.connect(white.user, white.send);
  live.connect(black.user, black.send);
  const t0 = 1_000_000;
  live.command(white.user, { type: 'seek', baseMs: 180000, incMs: 2000, color: 'w' }, t0);
  live.command(black.user, { type: 'seek', baseMs: 180000, incMs: 2000, color: 'b' }, t0);
  const gameId = white.inbox.find((msg) => msg.type === 'game').game.id;
  live.command(white.user, { type: 'move', gameId, uci: 'e2e4' }, t0 + 1000);
  live.command(white.user, { type: 'resign', gameId }, t0 + 2000);
  const queued = db.prepare(`SELECT * FROM jobs WHERE kind = 'review' AND payload_json LIKE ? AND status = 'queued'`).get(`%${gameId}%`);
  assert.ok(queued, 'a review job should be waiting');
  const claimed = claimJob(db, t0 + 3000);
  assert.equal(claimed.id, queued.id);
  const result = await runReview(db, claimed, {
    analyse: async () => [{ move: 'e7e5', kind: 'cp', value: 20, pv: ['e7e5'], depth: 8 }],
  });
  assert.equal(result.gameId, gameId);
  assert.equal(result.ply, 1);
  assert.equal(result.line[0].move, 'e7e5');
  finishJob(db, claimed.id, result, t0 + 4000);
});

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nJob checks passed');
process.exit(failed ? 1 : 0);
