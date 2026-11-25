// Friend search and requests. Run: node tests/server-friends.test.mjs
import assert from 'node:assert/strict';
import { startTestServer } from './server-harness.mjs';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL ${name}\n  ${err.stack || err.message}`); }
}

const srv = await startTestServer();
try {
  const ada = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_fr', password: 'correct-horse', email: 'ada.fr@example.com' } });
  const bea = await srv.api('POST', '/api/auth/register', { body: { username: 'Bea_fr', password: 'correct-horse', email: 'bea.fr@example.com' } });
  const cal = await srv.api('POST', '/api/auth/register', { body: { username: 'Qa_one', password: 'correct-horse', email: 'qa.one@example.com' } });
  const dee = await srv.api('POST', '/api/auth/register', { body: { username: 'Qabone', password: 'correct-horse', email: 'qab.one@example.com' } });
  assert.equal(ada.status, 200);
  assert.equal(bea.status, 200);
  assert.equal(cal.status, 200);
  assert.equal(dee.status, 200);
  const adaToken = ada.json.token;
  const beaToken = bea.json.token;

  await test('the friend list requires a session', async () => {
    assert.equal((await srv.api('GET', '/api/friends')).status, 401);
    assert.equal((await srv.api('GET', '/api/friends/search?q=be')).status, 401);
  });

  await test('search matches the start of a name and keeps an underscore literal', async () => {
    const short = await srv.api('GET', '/api/friends/search?q=b', { token: adaToken });
    assert.equal(short.status, 400);
    const odd = await srv.api('GET', '/api/friends/search?q=be*', { token: adaToken });
    assert.equal(odd.status, 400);
    const found = await srv.api('GET', '/api/friends/search?q=be', { token: adaToken });
    assert.equal(found.status, 200);
    assert.deepEqual(found.json.players.map((row) => row.username), ['Bea_fr']);
    assert.equal(found.json.players[0].friend, 'none');
    const self = await srv.api('GET', '/api/friends/search?q=ada', { token: adaToken });
    assert.deepEqual(self.json.players, []);
    const literal = await srv.api('GET', '/api/friends/search?q=qa_', { token: adaToken });
    assert.deepEqual(literal.json.players.map((row) => row.username), ['Qa_one']);
  });

  await test('a request can be declined, and a returned request becomes friendship', async () => {
    const self = await srv.api('POST', '/api/friends/request', { token: adaToken, body: { username: 'Ada_fr' } });
    assert.equal(self.status, 400);
    const missing = await srv.api('POST', '/api/friends/request', { token: adaToken, body: { username: 'Nobody_fr' } });
    assert.equal(missing.status, 404);
    const sent = await srv.api('POST', '/api/friends/request', { token: adaToken, body: { username: 'bea_fr' } });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.friend, 'outgoing');
    const again = await srv.api('POST', '/api/friends/request', { token: adaToken, body: { username: 'Bea_fr' } });
    assert.equal(again.status, 400);
    assert.match(again.json.error, /already waiting/);
    const adaList = await srv.api('GET', '/api/friends', { token: adaToken });
    assert.deepEqual(adaList.json.outgoing.map((row) => row.username), ['Bea_fr']);
    const beaList = await srv.api('GET', '/api/friends', { token: beaToken });
    assert.deepEqual(beaList.json.incoming.map((row) => row.username), ['Ada_fr']);
    const profile = await srv.api('GET', '/api/players/Bea_fr', { token: adaToken });
    assert.equal(profile.json.friend, 'outgoing');
    const declined = await srv.api('POST', '/api/friends/decline', { token: beaToken, body: { username: 'Ada_fr' } });
    assert.equal(declined.status, 200);
    assert.equal(declined.json.friend, 'none');
    assert.deepEqual((await srv.api('GET', '/api/friends', { token: adaToken })).json.outgoing, []);

    await srv.api('POST', '/api/friends/request', { token: adaToken, body: { username: 'Bea_fr' } });
    const returned = await srv.api('POST', '/api/friends/request', { token: beaToken, body: { username: 'Ada_fr' } });
    assert.equal(returned.status, 200);
    assert.equal(returned.json.friend, 'friends');
    const friends = await srv.api('GET', '/api/friends', { token: beaToken });
    assert.deepEqual(friends.json.friends.map((row) => row.username), ['Ada_fr']);
    assert.deepEqual(friends.json.incoming, []);
    const removed = await srv.api('POST', '/api/friends/remove', { token: adaToken, body: { username: 'Bea_fr' } });
    assert.equal(removed.status, 200);
    assert.deepEqual((await srv.api('GET', '/api/friends', { token: beaToken })).json.friends, []);
  });

  await test('accepting a request puts both players on the friend list', async () => {
    const sent = await srv.api('POST', '/api/friends/request', { token: adaToken, body: { username: 'Qa_one' } });
    assert.equal(sent.status, 200);
    const accepted = await srv.api('POST', '/api/friends/accept', { token: cal.json.token, body: { username: 'Ada_fr' } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.json.friend, 'friends');
    const wrong = await srv.api('POST', '/api/friends/accept', { token: adaToken, body: { username: 'Qa_one' } });
    assert.equal(wrong.status, 404);
    const list = await srv.api('GET', '/api/friends', { token: adaToken });
    assert.deepEqual(list.json.friends.map((row) => row.username), ['Qa_one']);
    const page = await srv.api('GET', '/api/players/Qa_one', { token: adaToken });
    assert.equal(page.json.friend, 'friends');
  });
} finally {
  await srv.close();
}

console.log(`\nFriend tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
