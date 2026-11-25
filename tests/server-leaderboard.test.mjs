// Leaderboards are separate for bullet, blitz and rapid. Two engine-like games
// in one pace leave that player off that list only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { assessColor, leaderboard, recordCheatFlags, submitAppeal, timingSupports } from '../server/cheat.mjs';
import { createLive } from '../server/live.mjs';
import { startTestServer } from './server-harness.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ornate-board-'));
const db = openDatabase(path.join(dir, 'test.sqlite'));
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL ${name}\n  ${err.stack || err.message}`); }
}

function move(color, match, loss = 0, extra = {}) {
  return {
    color,
    isBook: false,
    forced: false,
    legalCount: 20,
    uci: match ? 'e2e4' : 'd2d4',
    bestUci: 'e2e4',
    loss,
    ...extra,
  };
}

function stretch(color, count, matches, loss = 0) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(move(color, i < matches, loss));
  return out;
}

function addUser(id, name) {
  db.prepare('INSERT INTO users (id, username, username_fold, password_hash, created_at) VALUES (?, ?, ?, ?, 1)')
    .run(id, name, name.toLowerCase(), 'x');
}

function addPace(id, pace, rating, deviation) {
  db.prepare(`INSERT INTO pace_ratings (
    user_id, pace, rating, deviation, volatility, games, wins, draws, losses, peak,
    white_json, black_json, history_json, updated_at
  ) VALUES (?, ?, ?, ?, 0.06, 12, 7, 3, 2, ?, '{}', '{}', '[]', 1)`).run(
    id, pace, rating, deviation, deviation <= 110 ? rating : null,
  );
}

test('a short or ordinary game is not marked', () => {
  assert.equal(assessColor(stretch('w', 14, 14), 'w').flagged, false);
  assert.equal(assessColor(stretch('w', 15, 10), 'w').flagged, false);
  assert.equal(assessColor(stretch('w', 15, 15, 20), 'w').flagged, false);
  const bookish = stretch('w', 15, 15).map((row) => ({ ...row, isBook: true }));
  assert.equal(assessColor(bookish, 'w').flagged, false);
});

test('fifteen near-perfect moves outside the opening are marked', () => {
  const report = assessColor(stretch('b', 15, 14), 'b');
  assert.equal(report.flagged, true);
  assert.equal(report.moves, 15);
  assert.equal(report.matches, 14);
  assert.equal(assessColor(stretch('b', 15, 14), 'w').flagged, false);
});

test('each pace has its own list, and two marks hide only that pace', () => {
  addUser('ada', 'Ada');
  addUser('bea', 'Bea');
  addUser('cy', 'Cy');
  addPace('ada', 'bullet', 1800, 80);
  addPace('ada', 'blitz', 1500, 90);
  addPace('bea', 'bullet', 1600, 100);
  addPace('bea', 'blitz', 1700, 90);
  addPace('cy', 'bullet', 2000, 350);
  const perfect = stretch('w', 15, 15);
  assert.equal(recordCheatFlags(db, {
    gameId: 'g1', whiteId: 'ada', blackId: 'bea', pace: 'bullet', moves: perfect,
  }).flags, 1);
  assert.equal(recordCheatFlags(db, {
    gameId: 'g2', whiteId: 'ada', blackId: 'bea', pace: 'bullet', moves: perfect,
  }).flags, 1);
  const bullet = leaderboard(db, 'bullet');
  assert.deepEqual(bullet.players.map((row) => row.username), ['Bea']);
  const blitz = leaderboard(db, 'blitz');
  assert.deepEqual(blitz.players.map((row) => row.username), ['Bea', 'Ada']);
  const ada = leaderboard(db, 'bullet', 'ada');
  assert.equal(ada.you.held, true);
  assert.equal(ada.you.rank, null);
  const bea = leaderboard(db, 'blitz', 'bea');
  assert.equal(bea.you.rank, 1);
  assert.equal(bea.you.held, false);
});

await test('the public list follows the requested pace', async () => {
  const srv = await startTestServer();
  try {
    const ada = await srv.api('POST', '/api/auth/register', { body: { username: 'ada_board', password: 'correct-horse', email: 'ada_board@example.com' } });
    const bea = await srv.api('POST', '/api/auth/register', { body: { username: 'bea_board', password: 'correct-horse', email: 'bea_board@example.com' } });
    assert.equal(ada.status, 200);
    const insert = srv.db.prepare(`INSERT INTO pace_ratings (
      user_id, pace, rating, deviation, volatility, games, wins, draws, losses, peak,
      white_json, black_json, history_json, updated_at
    ) VALUES (?, ?, ?, 80, 0.06, 8, 5, 1, 2, ?, '{}', '{}', '[]', 1)`);
    insert.run(ada.json.user.id, 'rapid', 1710, 1710);
    insert.run(bea.json.user.id, 'bullet', 1550, 1550);
    const rapid = await srv.api('GET', '/api/leaderboard?pace=rapid');
    assert.equal(rapid.status, 200);
    assert.deepEqual(rapid.json.players.map((row) => row.username), ['ada_board']);
    const bullet = await srv.api('GET', '/api/leaderboard?pace=bullet', { token: ada.json.token });
    assert.deepEqual(bullet.json.players.map((row) => row.username), ['bea_board']);
    assert.equal(bullet.json.you.provisional, true);
    const bad = await srv.api('GET', '/api/leaderboard?pace=classical');
    assert.equal(bad.status, 400);
  } finally {
    await srv.close();
  }
});

await test('a played move keeps its think time', () => {
  const live = createLive(db);
  function seat(name) {
    const inbox = [];
    return { user: { id: name, username: name }, inbox, send(msg) { inbox.push(msg); } };
  }
  const white = seat('Tim');
  const black = seat('Tam');
  live.connect(white.user, white.send);
  live.connect(black.user, black.send);
  const t0 = 5_000_000;
  live.command(white.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'w' }, t0);
  live.command(black.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'b' }, t0);
  const gameId = white.inbox.find((msg) => msg.type === 'game').game.id;
  live.command(white.user, { type: 'move', gameId, uci: 'e2e4' }, t0 + 1500);
  live.command(white.user, { type: 'resign', gameId }, t0 + 2000);
  const stored = db.prepare('SELECT move_times_json FROM live_games WHERE id = ?').get(gameId);
  assert.deepEqual(JSON.parse(stored.move_times_json), [1500]);
});

await test('very fast steady moves support a mark, and ordinary times do not', () => {
  const moves = stretch('w', 15, 15);
  assert.equal(timingSupports(moves, 'w', Array(15).fill(200), 60000).supported, true);
  const ordinary = [500, 800, 1200, 2000, 4000, 1500, 900, 3000, 2500, 1800, 2200, 1600, 3500, 1100, 2700];
  assert.equal(timingSupports(moves, 'w', ordinary, 60000).supported, false);
  assert.equal(timingSupports(moves, 'w', [], 60000).supported, false);
  assert.equal(timingSupports(moves, 'w', Array(12).fill(200).concat([9000, 9000, 9000]), 60000).supported, true);
  assert.equal(timingSupports(moves, 'w', Array(11).fill(200).concat([9000, 9000, 9000, 9000]), 60000).supported, false);
});

await test('an appeal restores a name when the move times do not support the marks', () => {
  addUser('ned', 'Ned');
  addPace('ned', 'blitz', 1550, 80);
  const moves = stretch('w', 15, 15);
  const slow = [800, 1200, 2000, 4000, 1500, 900, 3000, 2500, 1800, 2200, 1600, 3500, 1100, 2700, 6000];
  recordCheatFlags(db, { gameId: 'slow1', whiteId: 'ned', blackId: 'bea', pace: 'blitz', moves, times: slow, baseMs: 180000 });
  recordCheatFlags(db, { gameId: 'slow2', whiteId: 'ned', blackId: 'bea', pace: 'blitz', moves, times: slow, baseMs: 180000 });
  assert.equal(db.prepare('SELECT timing_supported FROM cheat_flags WHERE game_id = ?').get('slow1').timing_supported, 0);
  assert.equal(leaderboard(db, 'blitz', 'ned').you.held, true);
  const accepted = submitAppeal(db, { userId: 'ned', pace: 'blitz', note: 'I was playing slowly.' });
  assert.equal(accepted.status, 'accepted');
  recordCheatFlags(db, { gameId: 'slow1', whiteId: 'ned', blackId: 'bea', pace: 'blitz', moves, times: slow, baseMs: 180000 });
  const back = leaderboard(db, 'blitz', 'ned');
  assert.equal(back.you.held, false);
  assert.equal(back.you.canAppeal, false);
  assert.ok(back.players.some((row) => row.username === 'Ned'));
});

await test('two fast marks stay off the list, and the same appeal cannot be repeated', () => {
  addUser('fay', 'Fay');
  addPace('fay', 'bullet', 1700, 70);
  const moves = stretch('w', 15, 15);
  const fast = Array(15).fill(200);
  recordCheatFlags(db, { gameId: 'fast1', whiteId: 'fay', blackId: 'bea', pace: 'bullet', moves, times: fast, baseMs: 60000 });
  recordCheatFlags(db, { gameId: 'fast2', whiteId: 'fay', blackId: 'bea', pace: 'bullet', moves, times: fast, baseMs: 60000 });
  assert.equal(db.prepare('SELECT timing_supported FROM cheat_flags WHERE game_id = ?').get('fast1').timing_supported, 1);
  assert.equal(submitAppeal(db, { userId: 'fay', pace: 'bullet', note: '' }).status, 'declined');
  assert.equal(leaderboard(db, 'bullet', 'fay').you.held, true);
  assert.equal(leaderboard(db, 'bullet', 'fay').you.canAppeal, false);
  assert.throws(() => submitAppeal(db, { userId: 'fay', pace: 'bullet', note: 'again' }), (err) => err.status === 400);
  assert.throws(() => submitAppeal(db, { userId: 'fay', pace: 'bullet', note: 'x'.repeat(401) }), (err) => err.status === 400);
  recordCheatFlags(db, { gameId: 'fast3', whiteId: 'fay', blackId: 'bea', pace: 'bullet', moves, times: fast, baseMs: 60000, now: Date.now() + 50 });
  assert.equal(leaderboard(db, 'bullet', 'fay').you.canAppeal, true);
  assert.equal(submitAppeal(db, { userId: 'fay', pace: 'bullet' }).status, 'declined');
});

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nLeaderboard checks passed');
process.exit(failed ? 1 : 0);
