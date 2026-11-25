// Account API. Run: node tests/server-auth.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './server-harness.mjs';

const outbox = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'outbox');

function outboxNames() {
  if (!fs.existsSync(outbox)) return [];
  return fs.readdirSync(outbox);
}

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

  await test('registration rejects a short password, a bad username, and a missing email', async () => {
    const password = await srv.api('POST', '/api/auth/register', { body: { username: 'ada', password: 'short', email: 'ada@example.com' } });
    assert.equal(password.status, 400);
    const name = await srv.api('POST', '/api/auth/register', { body: { username: 'a', password: 'long-enough', email: 'ada@example.com' } });
    assert.equal(name.status, 400);
    const email = await srv.api('POST', '/api/auth/register', { body: { username: 'No_Mail', password: 'long-enough' } });
    assert.equal(email.status, 400);
    assert.match(email.json.error, /email/i);
  });

  let token = '';
  await test('registration returns a session and the profile', async () => {
    const res = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_1', password: 'correct-horse', email: 'Ada1@Example.com' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.username, 'Ada_1');
    assert.equal(res.json.user.email, undefined);
    assert.equal(typeof res.json.token, 'string');
    token = res.json.token;
    const me = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.username, 'Ada_1');
    assert.equal(me.json.user.email, 'ada1@example.com');
    assert.equal(me.json.user.emailVerified, true);
  });

  await test('the same username in another case is refused', async () => {
    const res = await srv.api('POST', '/api/auth/register', { body: { username: 'ada_1', password: 'another-password', email: 'other@example.com' } });
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
    const res = await srv.api('POST', '/api/auth/register', { body: { username: 'Pace_User', password: 'correct-horse', email: 'pace@example.com' } });
    const ratings = await srv.api('GET', '/api/ratings', { token: res.json.token });
    assert.equal(ratings.status, 200);
    for (const pace of ['bullet', 'blitz', 'rapid']) {
      assert.equal(ratings.json.ratings[pace].rating, 1500, pace);
      assert.equal(ratings.json.ratings[pace].games, 0, pace);
      assert.equal(ratings.json.ratings[pace].provisional, true, pace);
    }
  });

  await test('the password can be changed and the same session keeps working', async () => {
    const created = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_Pass', password: 'correct-horse', email: 'Ada@Example.com' } });
    const token = created.json.token;
    const missing = await srv.api('POST', '/api/auth/password', { body: { current: 'correct-horse', next: 'another-horse' } });
    assert.equal(missing.status, 401);
    const wrong = await srv.api('POST', '/api/auth/password', { token, body: { current: 'wrong-password', next: 'another-horse' } });
    assert.equal(wrong.status, 401);
    assert.match(wrong.json.error, /not correct/);
    const same = await srv.api('POST', '/api/auth/password', { token, body: { current: 'correct-horse', next: 'correct-horse' } });
    assert.equal(same.status, 400);
    assert.match(same.json.error, /different/);
    const before = new Set(outboxNames());
    const otherInbox = await srv.api('POST', '/api/auth/password', { token, body: { current: 'correct-horse', next: 'another-horse', email: 'other@example.com' } });
    assert.equal(otherInbox.status, 400);
    assert.match(otherInbox.json.error, /saved when the account was created/);
    assert.equal(outboxNames().filter((name) => !before.has(name)).length, 0);
    const pending = srv.db.prepare('SELECT email FROM password_resets WHERE user_id = ?').get(created.json.user.id);
    assert.equal(pending, undefined);
    const unchanged = await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Pass', password: 'another-horse' } });
    assert.equal(unchanged.status, 401);
    const changed = await srv.api('POST', '/api/auth/password', { token, body: { current: 'correct-horse', next: 'another-horse' } });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.status, 'pending');
    assert.equal(changed.json.delivery, 'saved');
    assert.match(changed.json.preview, /^\d{6}$/);
    assert.equal(changed.json.email, 'a•••@example.com');
    const mailed = outboxNames().filter((name) => !before.has(name));
    assert.equal(mailed.length, 1);
    const letter = fs.readFileSync(path.join(outbox, mailed[0]), 'utf8');
    assert.match(letter, /To: ada@example.com/);
    assert.doesNotMatch(letter, /other@example.com/);
    fs.unlinkSync(path.join(outbox, mailed[0]));
    const early = await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Pass', password: 'another-horse' } });
    assert.equal(early.status, 401);
    const wrongCode = await srv.api('POST', '/api/auth/password/confirm', { token, body: { code: '000000' } });
    assert.equal(wrongCode.status, 400);
    const confirmed = await srv.api('POST', '/api/auth/password/confirm', { token, body: { code: changed.json.preview } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.json.ok, true);
    const still = await srv.api('GET', '/api/auth/me', { token });
    assert.equal(still.status, 200);
    assert.equal(still.json.user.username, 'Ada_Pass');
    assert.equal(still.json.user.email, 'ada@example.com');
    assert.equal(still.json.user.emailVerified, true);
    const old = await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Pass', password: 'correct-horse' } });
    assert.equal(old.status, 401);
    const next = await srv.api('POST', '/api/auth/login', { body: { username: 'ada_pass', password: 'another-horse' } });
    assert.equal(next.status, 200);
    const stillOther = await srv.api('POST', '/api/auth/password', { token: next.json.token, body: { current: 'another-horse', next: 'third-horse', email: 'other@example.com' } });
    assert.equal(stillOther.status, 400);
    assert.match(stillOther.json.error, /saved when the account was created/);
  });

  await test('an account without an email cannot attach one during a password change', async () => {
    const created = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_Legacy', password: 'correct-horse', email: 'legacy@example.com' } });
    srv.db.prepare('UPDATE users SET email = NULL, email_verified = 0 WHERE id = ?').run(created.json.user.id);
    const before = new Set(outboxNames());
    const res = await srv.api('POST', '/api/auth/password', { token: created.json.token, body: { current: 'correct-horse', next: 'another-horse', email: 'attacker@example.com' } });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /no email address/);
    assert.equal(srv.db.prepare('SELECT user_id FROM password_resets WHERE user_id = ?').get(created.json.user.id), undefined);
    assert.equal(outboxNames().filter((name) => !before.has(name)).length, 0);
    const still = await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Legacy', password: 'correct-horse' } });
    assert.equal(still.status, 200);
  });

  await test('deleting an account requires the password and removes the sign-in', async () => {
    const token = (await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Pass', password: 'another-horse' } })).json.token;
    const wrong = await srv.api('POST', '/api/auth/delete', { token, body: { password: 'correct-horse' } });
    assert.equal(wrong.status, 401);
    assert.equal((await srv.api('GET', '/api/auth/me', { token })).status, 200);
    const gone = await srv.api('POST', '/api/auth/delete', { token, body: { password: 'another-horse' } });
    assert.equal(gone.status, 200);
    assert.equal(gone.json.ok, true);
    assert.equal((await srv.api('GET', '/api/auth/me', { token })).status, 401);
    const login = await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Pass', password: 'another-horse' } });
    assert.equal(login.status, 401);
    const row = srv.db.prepare('SELECT id FROM users WHERE username_fold = ?').get('ada_pass');
    assert.equal(row, undefined);
  });

  function freshOutbox(before) {
    return outboxNames().filter((name) => !before.has(name));
  }

  await test('a forgotten password is reset from the saved email and the code is not returned', async () => {
    const created = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_Rec', password: 'correct-horse', email: 'Ada.Rec@Example.com' } });
    assert.equal(created.status, 200);
    const before = new Set(outboxNames());
    const same = await srv.api('POST', '/api/auth/recover', { body: { username: 'Ada_Rec', next: 'correct-horse' } });
    assert.equal(same.status, 400);
    assert.match(same.json.error, /different from the current/);
    const other = await srv.api('POST', '/api/auth/recover', { body: { username: 'Ada_Rec', next: 'reset-horse', email: 'other@example.com' } });
    assert.equal(other.status, 400);
    assert.match(other.json.error, /saved when the account was created/);
    assert.equal(freshOutbox(before).length, 0);
    const pending = await srv.api('POST', '/api/auth/recover', { body: { username: 'ada_rec', next: 'reset-horse' } });
    assert.equal(pending.status, 200);
    assert.equal(pending.json.status, 'pending');
    assert.equal(pending.json.delivery, 'saved');
    assert.equal(pending.json.preview, undefined);
    assert.equal(pending.json.email, undefined);
    const mailed = freshOutbox(before);
    assert.equal(mailed.length, 1);
    const letter = fs.readFileSync(path.join(outbox, mailed[0]), 'utf8');
    assert.match(letter, /To: ada.rec@example.com/);
    assert.doesNotMatch(letter, /other@example.com/);
    const code = (/The confirmation code is (\d{6})/.exec(letter) || [])[1];
    assert.equal(code.length, 6);
    const swapped = await srv.api('POST', '/api/auth/recover', { body: { username: 'Ada_Rec', next: 'third-horse', email: 'third@example.com' } });
    assert.equal(swapped.status, 400);
    assert.equal(freshOutbox(before).length, 1);
    const wrong = await srv.api('POST', '/api/auth/recover/confirm', { body: { username: 'Ada_Rec', code: '000000' } });
    assert.equal(wrong.status, 400);
    const confirmed = await srv.api('POST', '/api/auth/recover/confirm', { body: { username: 'Ada_Rec', code } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.json.ok, true);
    assert.equal(confirmed.json.token, undefined);
    assert.equal((await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Rec', password: 'correct-horse' } })).status, 401);
    const next = await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Rec', password: 'reset-horse' } });
    assert.equal(next.status, 200);
    const me = await srv.api('GET', '/api/auth/me', { token: next.json.token });
    assert.equal(me.json.user.email, 'ada.rec@example.com');
    fs.unlinkSync(path.join(outbox, mailed[0]));
  });

  await test('an unknown username looks the same and writes no message', async () => {
    const before = new Set(outboxNames());
    const res = await srv.api('POST', '/api/auth/recover', { body: { username: 'Missing_User', next: 'long-enough' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'pending');
    assert.equal(res.json.delivery, null);
    assert.equal(res.json.preview, undefined);
    assert.equal(freshOutbox(before).length, 0);
    const short = await srv.api('POST', '/api/auth/recover', { body: { username: 'Missing_User', next: 'short' } });
    assert.equal(short.status, 400);
  });

  await test('a new email is confirmed from the old address and does not change the password', async () => {
    const created = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_Mail', password: 'correct-horse', email: 'old.mail@example.com' } });
    const before = new Set(outboxNames());
    const pending = await srv.api('POST', '/api/auth/email', { token: created.json.token, body: { current: 'correct-horse', email: 'new.mail@example.com' } });
    assert.equal(pending.status, 200);
    assert.equal(pending.json.email, 'o•••@example.com');
    assert.equal(pending.json.delivery, 'saved');
    assert.equal(typeof pending.json.preview, 'string');
    const mailed = freshOutbox(before);
    assert.equal(mailed.length, 1);
    const letter = fs.readFileSync(path.join(outbox, mailed[0]), 'utf8');
    assert.match(letter, /To: old.mail@example.com/);
    assert.doesNotMatch(letter, /new\.mail@example.com/);
    const early = await srv.api('GET', '/api/auth/me', { token: created.json.token });
    assert.equal(early.json.user.email, 'old.mail@example.com');
    const confirmed = await srv.api('POST', '/api/auth/email/confirm', { token: created.json.token, body: { code: pending.json.preview } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.json.email, 'new.mail@example.com');
    const me = await srv.api('GET', '/api/auth/me', { token: created.json.token });
    assert.equal(me.json.user.email, 'new.mail@example.com');
    assert.equal((await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Mail', password: 'correct-horse' } })).status, 200);
    fs.unlinkSync(path.join(outbox, mailed[0]));
  });

  await test('a password confirmation does not consume an email-change code', async () => {
    const created = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_Mix', password: 'correct-horse', email: 'mix.old@example.com' } });
    const before = new Set(outboxNames());
    const pending = await srv.api('POST', '/api/auth/email', { token: created.json.token, body: { current: 'correct-horse', email: 'mix.new@example.com' } });
    assert.equal(pending.status, 200);
    const crossed = await srv.api('POST', '/api/auth/password/confirm', { token: created.json.token, body: { code: pending.json.preview } });
    assert.equal(crossed.status, 400);
    assert.equal(crossed.json.error, 'Ask for a confirmation code first.');
    assert.equal((await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Mix', password: 'correct-horse' } })).status, 200);
    assert.equal((await srv.api('GET', '/api/auth/me', { token: created.json.token })).json.user.email, 'mix.old@example.com');
    const confirmed = await srv.api('POST', '/api/auth/email/confirm', { token: created.json.token, body: { code: pending.json.preview } });
    assert.equal(confirmed.status, 200);
    assert.equal((await srv.api('GET', '/api/auth/me', { token: created.json.token })).json.user.email, 'mix.new@example.com');
    assert.equal((await srv.api('POST', '/api/auth/login', { body: { username: 'Ada_Mix', password: 'correct-horse' } })).status, 200);
    for (const name of freshOutbox(before)) fs.unlinkSync(path.join(outbox, name));
  });
} finally {
  await srv.close();
}

console.log(`\nServer auth tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
