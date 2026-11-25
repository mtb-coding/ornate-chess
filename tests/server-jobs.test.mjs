// Background job queue: backups, and a review request after a finished game.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { claimJob, enqueueJob, failJob, finishJob, runBackup, runReview } from '../server/jobs.mjs';
import { createLive } from '../server/live.mjs';
import { listGamePuzzles } from '../server/reviews.mjs';
import { startTestServer } from './server-harness.mjs';

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
  let calls = 0;
  const result = await runReview(db, claimed, {
    analyse: async (fen) => {
      calls += 1;
      const turn = fen.split(' ')[1];
      if (turn === 'w') {
        return [
          { move: 'd2d4', kind: 'cp', value: 400, pv: ['d2d4'] },
          { move: 'a2a3', kind: 'cp', value: 0, pv: ['a2a3'] },
        ];
      }
      return [
        { move: 'e7e5', kind: 'cp', value: 400, pv: ['e7e5'] },
        { move: 'a7a6', kind: 'cp', value: 0, pv: ['a7a6'] },
      ];
    },
  });
  assert.equal(result.gameId, gameId);
  assert.equal(result.ply, 1);
  assert.equal(result.depth, 12);
  assert.ok(calls >= 2, 'every position is reviewed');
  assert.equal(result.puzzles, 1);
  const stored = db.prepare('SELECT review_json FROM game_reviews WHERE game_id = ?').get(gameId);
  assert.equal(JSON.parse(stored.review_json).moves.length, 1);
  const puzzles = listGamePuzzles(db, 'Ada');
  assert.equal(puzzles.length, 1);
  assert.equal(puzzles[0].solution[0], 'd2d4');
  assert.equal(puzzles[0].color, 'w');
  assert.equal(listGamePuzzles(db, 'Bea').length, 0);
  finishJob(db, claimed.id, result, t0 + 4000);
});

await test('a player can read and solve a puzzle from an online game', async () => {
  const srv = await startTestServer();
  try {
    const registered = await srv.api('POST', '/api/auth/register', { body: { username: 'ada_jobs', password: 'correct-horse' } });
    assert.equal(registered.status, 200);
    const token = registered.json.token;
    const userId = registered.json.user.id;
    const other = await srv.api('POST', '/api/auth/register', { body: { username: 'bea_jobs', password: 'correct-horse' } });
    const gameId = 'game-ada';
    srv.db.prepare(`INSERT INTO live_games (
      id, base_ms, inc_ms, white_id, black_id, white_name, black_name, game_json,
      w_ms, b_ms, turn_started_at, status, result, result_reason, draw_offer, created_at, updated_at
    ) VALUES (?, 180000, 2000, ?, ?, 'ada_jobs', 'bea_jobs', '{}', 180000, 180000, NULL, 'finished', '0-1', 'resignation', NULL, 1, 1)`).run(gameId, userId, other.json.user.id);
    const { saveGameReview } = await import('../server/reviews.mjs');
    saveGameReview(srv.db, {
      gameId,
      whiteId: userId,
      blackId: other.json.user.id,
      now: 5,
      review: {
        depth: 12,
        name: 'ada_jobs against bea_jobs',
        mistakes: [{
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          solution: ['d2d4'],
          playedUci: 'e2e4',
          playedSan: 'e4',
          bestSan: 'd4',
          judgment: 'blunder',
          ply: 1,
          color: 'w',
        }],
      },
    });
    const hidden = await srv.api('GET', '/api/puzzles');
    assert.equal(hidden.status, 401);
    const listed = await srv.api('GET', '/api/puzzles', { token });
    assert.equal(listed.status, 200);
    assert.equal(listed.json.puzzles.length, 1);
    assert.equal(listed.json.puzzles[0].bestSan, 'd4');
    const black = await srv.api('GET', `/api/reviews/${gameId}`, { token: other.json.token });
    assert.equal(black.status, 200);
    assert.equal(black.json.review.name, 'ada_jobs against bea_jobs');
    const own = await srv.api('GET', `/api/reviews/${gameId}`, { token });
    assert.equal(own.json.review.name, 'ada_jobs against bea_jobs');
    const outsider = await srv.api('POST', '/api/auth/register', { body: { username: 'cy_jobs', password: 'correct-horse' } });
    const denied = await srv.api('GET', `/api/reviews/${gameId}`, { token: outsider.json.token });
    assert.equal(denied.status, 403);
    const id = listed.json.puzzles[0].id;
    const marked = await srv.api('POST', `/api/puzzles/${id}`, { token, body: { solved: true, attempts: 1, usedHint: false } });
    assert.equal(marked.status, 200);
    assert.equal(marked.json.puzzle.solved, true);
    const again = await srv.api('GET', '/api/puzzles', { token });
    assert.equal(again.json.puzzles[0].solved, true);
    saveGameReview(srv.db, {
      gameId,
      whiteId: userId,
      blackId: other.json.user.id,
      now: 9,
      review: {
        depth: 12,
        name: 'ada_jobs against bea_jobs',
        mistakes: [{
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          solution: ['d2d4'],
          playedUci: 'e2e4',
          playedSan: 'e4',
          bestSan: 'd4',
          judgment: 'blunder',
          ply: 1,
          color: 'w',
        }],
      },
    });
    const kept = await srv.api('GET', '/api/puzzles', { token });
    assert.equal(kept.json.puzzles.length, 1);
    assert.equal(kept.json.puzzles[0].solved, true);
  } finally {
    await srv.close();
  }
});

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nJob checks passed');
process.exit(failed ? 1 : 0);
