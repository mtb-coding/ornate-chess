// Account API. Run: node tests/server-auth.test.mjs
import assert from 'node:assert/strict';
import { startTestServer } from './server-harness.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.stack || err)); }
}

const srv = await startTestServer();
try {
  await test('health answers without a session', async () => {
    const res = await srv.api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });

  await test('an unknown address is rejected', async () => {
    const res = await srv.api('GET', '/api/missing');
    assert.equal(res.status, 404);
  });

  await test('a local origin is allowed and another origin is refused', async () => {
    const ok = await fetch(`http://127.0.0.1:${srv.port}/api/health`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:8002', 'access-control-request-method': 'GET' },
    });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:8002');
    const blocked = await srv.api('GET', '/api/health', { origin: 'https://evil.example' });
    assert.equal(blocked.status, 403);
  });

  await test('registration rejects a short password and a bad username', async () => {
    const password = await srv.api('POST', '/api/auth/register', { body: { username: 'ada', password: 'short' } });
    assert.equal(password.status, 400);
    const name = await srv.api('POST', '/api/auth/register', { body: { username: 'a', password: 'long-enough' } });
    assert.equal(name.status, 400);
  });

  let token = '';
  await test('registration returns a session and the profile', async () => {
    const res = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_1', password: 'correct-horse' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.username, 'Ada_1');
    assert.equal(typeof res.json.token, 'string');
    token = res.json.token;
    const me = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.username, 'Ada_1');
  });

  await test('the same username in another case is refused', async () => {
    const res = await srv.api('POST', '/api/auth/register', { body: { username: 'ada_1', password: 'another-password' } });
    assert.equal(res.status, 409);
  });

  await test('login accepts the original case and rejects a wrong password', async () => {
    const bad = await srv.api('POST', '/api/auth/login', { body: { username: 'ada_1', password: 'wrong-password' } });
    assert.equal(bad.status, 401);
    const good = await srv.api('POST', '/api/auth/login', { body: { username: 'ADA_1', password: 'correct-horse' } });
    assert.equal(good.status, 200);
    assert.equal(good.json.user.username, 'Ada_1');
    token = good.json.token;
  });

  await test('logout ends the session, and an expired session is refused', async () => {
    const gone = await srv.api('POST', '/api/auth/logout', { token });
    assert.equal(gone.status, 200);
    const me = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(me.status, 401);
    const again = await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_1', password: 'correct-horse' } });
    srv.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1000);
    const expired = await srv.api('GET', '/api/auth/me', { token: again.json.token });
    assert.equal(expired.status, 401);
  });

  await test('a missing token cannot read the profile', async () => {
    const res = await srv.api('GET', '/api/auth/me');
    assert.equal(res.status, 401);
  });

  await test('a new account has a provisional rating in each pace', async () => {
    const denied = await srv.api('GET', '/api/ratings');
    assert.equal(denied.status, 401);
    const res = await srv.api('POST', '/api/auth/register', { body: { username: 'Pace_User', password: 'correct-horse' } });
    const ratings = await srv.api('GET', '/api/ratings', { token: res.json.token });
    assert.equal(ratings.status, 200);
    for (const pace of ['bullet', 'blitz', 'rapid']) {
      assert.equal(ratings.json.ratings[pace].rating, 1500, pace);
      assert.equal(ratings.json.ratings[pace].games, 0, pace);
      assert.equal(ratings.json.ratings[pace].provisional, true, pace);
    }
  });
} finally {
  await srv.close();
}

console.log(`\nServer auth tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
