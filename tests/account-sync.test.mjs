// Sync planning and a round trip through the account API.
// Run: node tests/account-sync.test.mjs
import assert from 'node:assert/strict';
import { MemoryStorage } from '../src/storage.js';
import { applyWrites, hashValue, planSync, readSnapshot, unsyncedConflicts } from '../src/account-sync.js';
import { syncNow } from '../src/ui/account-client.js';
import { startTestServer } from './server-harness.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.stack || err)); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.stack || err)); }
}

const game = (id) => ({ id, name: 'Game', savedAt: 1, mode: 'bot', game: { version: 1, startFen: 'start', uci: [] } });

test('an empty local list does not replace account games', () => {
  const plan = planSync({
    localValues: { games: [] },
    meta: {},
    remote: [{ key: 'games', value: [game('server')], updatedAt: 10, deleted: false }],
    now: 100,
  });
  assert.equal(plan.push.length, 0);
  assert.equal(plan.writeLocal[0].value[0].id, 'server');
});

test('local games are uploaded when the account has none', () => {
  const plan = planSync({
    localValues: { games: [game('device')] },
    meta: {},
    remote: [],
    now: 100,
  });
  assert.equal(plan.push.length, 1);
  assert.equal(plan.push[0].key, 'games');
  assert.equal(plan.push[0].value[0].id, 'device');
  assert.equal(plan.push[0].updatedAt, 100);
});

test('an empty default is not uploaded by itself', () => {
  const plan = planSync({ localValues: { games: [], stats: { totals: { games: 0 } } }, meta: {}, remote: [], now: 100 });
  assert.equal(plan.push.length, 0);
});

test('a newer account value replaces the device, and an older one does not', () => {
  const deviceStats = { totals: { games: 1 } };
  const newer = planSync({
    localValues: { stats: deviceStats },
    meta: { stats: { updatedAt: 10, hash: hashValue(deviceStats), deleted: false } },
    remote: [{ key: 'stats', value: { totals: { games: 4 } }, updatedAt: 20, deleted: false }],
    now: 30,
  });
  assert.equal(newer.push.length, 0);
  assert.equal(newer.writeLocal[0].value.totals.games, 4);

  const local = { stats: { totals: { games: 2 } } };
  const first = planSync({ localValues: local, meta: {}, remote: [], now: 5 });
  const older = planSync({
    localValues: local,
    meta: first.meta,
    remote: [{ key: 'stats', value: { totals: { games: 1 } }, updatedAt: 4, deleted: false }],
    now: 9,
  });
  assert.equal(older.writeLocal.length, 0);
  assert.equal(older.push.length, 1);
  assert.equal(older.push[0].value.totals.games, 2);
});

test('a second plan with the same device value does not upload again', () => {
  const localValues = { 'player-rating': { games: 3, rating: 1300 } };
  const first = planSync({ localValues, meta: {}, remote: [], now: 10 });
  const second = planSync({ localValues, meta: first.meta, remote: [{ key: 'player-rating', value: localValues['player-rating'], updatedAt: 10, deleted: false }], now: 40 });
  assert.equal(second.push.length, 0);
  assert.equal(second.writeLocal.length, 0);
});

test('deleting a synced key uploads a tombstone, and a newer tombstone removes it locally', () => {
  const kept = planSync({
    localValues: { 'gen-stats': { solved: 2, attempted: 3 } },
    meta: {},
    remote: [],
    now: 10,
  });
  const removed = planSync({ localValues: {}, meta: kept.meta, remote: [], now: 12 });
  assert.equal(removed.push.length, 1);
  assert.equal(removed.push[0].deleted, true);
  const current = { solved: 2, attempted: 3 };
  const remoteDelete = planSync({
    localValues: { 'gen-stats': current },
    meta: { 'gen-stats': { updatedAt: 10, hash: hashValue(current), deleted: false } },
    remote: [{ key: 'gen-stats', value: null, updatedAt: 15, deleted: true }],
    now: 16,
  });
  assert.equal(remoteDelete.writeLocal[0].deleted, true);
  assert.equal(remoteDelete.push.length, 0);
});

test('review storage keeps the 30 newest stamps', () => {
  const localValues = {};
  for (let i = 0; i < 31; i++) localValues[`review:${i.toString(36)}`] = { i };
  const plan = planSync({ localValues, meta: {}, remote: [], now: 50 });
  const live = plan.push.filter((entry) => !entry.deleted);
  assert.equal(live.length, 30);
  assert.ok(plan.push.some((entry) => entry.deleted));
});

test('unsynced differences are reported until a side is chosen', () => {
  const localValues = { games: [game('device')] };
  const remote = [{ key: 'games', value: [game('server')], updatedAt: 4, deleted: false }];
  assert.deepEqual(unsyncedConflicts({ localValues, meta: {}, remote }), ['games']);
  const keepAccount = planSync({ localValues, meta: {}, remote, now: 20, prefer: 'remote' });
  assert.equal(keepAccount.push.length, 0);
  assert.equal(keepAccount.writeLocal[0].value[0].id, 'server');
  const keepDevice = planSync({ localValues, meta: {}, remote, now: 20, prefer: 'local' });
  assert.equal(keepDevice.push[0].value[0].id, 'device');
});

test('saved games over 50 are trimmed before upload', () => {
  const games = Array.from({ length: 51 }, (_, i) => game('g' + i));
  const plan = planSync({ localValues: { games }, meta: {}, remote: [], now: 3 });
  assert.equal(plan.push[0].value.length, 50);
  assert.equal(plan.writeLocal[0].value.length, 50);
});

test('snapshot round-trip writes and removes keys', () => {
  const backend = new MemoryStorage();
  applyWrites(backend, [
    { key: 'stats', value: { totals: { games: 1 } }, deleted: false },
    { key: 'review:ab', value: { n: 1 }, deleted: false },
  ]);
  const snap = readSnapshot(backend);
  assert.equal(snap.stats.totals.games, 1);
  assert.equal(snap['review:ab'].n, 1);
  applyWrites(backend, [{ key: 'review:ab', deleted: true }]);
  assert.equal(readSnapshot(backend)['review:ab'], undefined);
});

await testAsync('a device syncs with the account server and does not send the same items twice', async () => {
  const srv = await startTestServer();
  try {
    const registered = await srv.api('POST', '/api/auth/register', { body: { username: 'ada_sync', password: 'correct-horse', email: 'ada_sync@example.com' } });
    assert.equal(registered.status, 200);
    const token = registered.json.token;
    const userId = registered.json.user.id;
    const base = `http://127.0.0.1:${srv.port}`;
    const backend = new MemoryStorage();
    backend.setItem('ornate-chess:games', JSON.stringify([game('local-1')]));
    const first = await syncNow({ backend, token, userId, apiBase: base, now: Date.now() });
    assert.equal(first.ok, true, first.message);
    assert.equal(first.pushed, 1);
    const stored = await srv.api('GET', '/api/sync', { token });
    assert.equal(stored.json.entries[0].value[0].id, 'local-1');
    const second = await syncNow({ backend, token, userId, apiBase: base, now: Date.now() });
    assert.equal(second.ok, true, second.message);
    assert.equal(second.pushed, 0);
    await srv.api('PUT', '/api/sync', {
      token,
      body: { entries: [{ key: 'stats', value: { totals: { games: 6 } }, updatedAt: Date.now() + 1000, deleted: false }] },
    });
    const third = await syncNow({ backend, token, userId, apiBase: base, now: Date.now() });
    assert.equal(third.applied >= 1, true, third.message);
    assert.equal(JSON.parse(backend.getItem('ornate-chess:stats')).totals.games, 6);
    const settings = backend.getItem('ornate-chess:settings');
    assert.equal(settings, null);
  } finally {
    await srv.close();
  }
});

console.log(`\nAccount sync tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
