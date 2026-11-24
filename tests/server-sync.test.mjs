// Progress sync API. Run: node tests/server-sync.test.mjs
import assert from 'node:assert/strict';
import { startTestServer } from './server-harness.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.stack || err)); }
}

const srv = await startTestServer();
try {
  const registered = await srv.api('POST', '/api/auth/register', {
    body: { username: 'sync_user', password: 'correct-horse' },
  });
  assert.equal(registered.status, 200);
  const token = registered.json.token;
  const put = (entries) => srv.api('PUT', '/api/sync', { token, body: { entries } });

  await test('sync requires a session', async () => {
    const res = await srv.api('GET', '/api/sync');
    assert.equal(res.status, 401);
  });

  await test('a saved value round-trips and an older stamp does not replace it', async () => {
    const first = await put([{ key: 'stats', value: { games: 1 }, updatedAt: 1_000, deleted: false }]);
    assert.equal(first.status, 200);
    const older = await put([{ key: 'stats', value: { games: 99 }, updatedAt: 1_000, deleted: false }]);
    assert.equal(older.status, 200);
    const read = await srv.api('GET', '/api/sync', { token });
    assert.equal(read.json.entries.length, 1);
    assert.deepEqual(read.json.entries[0].value, { games: 1 });
    const newer = await put([{ key: 'stats', value: { games: 2 }, updatedAt: 2_000, deleted: false }]);
    assert.equal(newer.status, 200);
    const again = await srv.api('GET', '/api/sync', { token });
    assert.deepEqual(again.json.entries[0].value, { games: 2 });
    assert.equal(again.json.entries[0].deleted, false);
  });

  await test('a delete is kept as a tombstone', async () => {
    const res = await put([{ key: 'stats', value: null, updatedAt: 3_000, deleted: true }]);
    assert.equal(res.status, 200);
    const read = await srv.api('GET', '/api/sync', { token });
    assert.equal(read.json.entries[0].deleted, true);
    assert.equal(read.json.entries[0].value, null);
  });

  await test('device settings and an oversized game list are refused', async () => {
    const settings = await put([{ key: 'settings', value: { theme: 'ivory' }, updatedAt: 4_000 }]);
    assert.equal(settings.status, 400);
    const games = await put([{ key: 'games', value: Array.from({ length: 51 }, () => ({})), updatedAt: 4_000 }]);
    assert.equal(games.status, 400);
  });

  await test('review storage stops at 30 and accepts a replacement after a delete', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      key: `review:${i.toString(36)}`,
      value: { i },
      updatedAt: 5_000,
    }));
    const stored = await put(entries);
    assert.equal(stored.status, 200);
    const extra = await put([{ key: 'review:extra', value: { i: 99 }, updatedAt: 6_000 }]);
    assert.equal(extra.status, 400);
    const swapped = await put([
      { key: 'review:0', updatedAt: 7_000, deleted: true },
      { key: 'review:extra', value: { i: 99 }, updatedAt: 7_000 },
    ]);
    assert.equal(swapped.status, 200);
    const read = await srv.api('GET', '/api/sync', { token });
    const live = read.json.entries.filter((entry) => entry.key.startsWith('review:') && !entry.deleted);
    assert.equal(live.length, 30);
    assert.ok(live.some((entry) => entry.key === 'review:extra'));
  });

  await test('a value over 1 MB is refused', async () => {
    const res = await put([{ key: 'gen-stats', value: 'x'.repeat(1024 * 1024 + 1), updatedAt: 8_000 }]);
    assert.equal(res.status, 400);
  });
} finally {
  await srv.close();
}

console.log(`\nServer sync tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
