// Direct challenges, a public finished game, and resuming a live game.
// Run: node tests/server-challenge.test.mjs
import assert from 'node:assert/strict';
import { startTestServer } from './server-harness.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.stack || err)); }
}

function openSocket(port, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const inbox = [];
    ws.addEventListener('message', (ev) => { inbox.push(JSON.parse(ev.data)); });
    ws.addEventListener('error', () => reject(new Error('The socket failed.')));
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', token }));
      resolve({
        ws,
        send(obj) { ws.send(JSON.stringify(obj)); },
        async wait(pred, ms = 2000) {
          const start = Date.now();
          while (Date.now() - start < ms) {
            const found = inbox.find(pred);
            if (found) return found;
            await new Promise((done) => setTimeout(done, 20));
          }
          throw new Error(`The socket sent no matching message: ${JSON.stringify(inbox)}`);
        },
      });
    });
  });
}

const srv = await startTestServer();
try {
  const ada = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_Ch', password: 'correct-horse', email: 'ada.ch@example.com' } });
  const bea = await srv.api('POST', '/api/auth/register', { body: { username: 'Bea_Ch', password: 'correct-horse', email: 'bea.ch@example.com' } });
  const cal = await srv.api('POST', '/api/auth/register', { body: { username: 'Cal_Ch', password: 'correct-horse', email: 'cal.ch@example.com' } });
  assert.equal(ada.status, 200);
  assert.equal(bea.status, 200);
  const adaToken = ada.json.token;
  const beaToken = bea.json.token;

  await test('a challenge must use a listed clock, another player, and one offer at a time', async () => {
    const bad = await srv.api('POST', '/api/challenges', { token: adaToken, body: { username: 'Bea_Ch', baseMs: 420000, incMs: 3000, color: 'w' } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /listed time controls/);
    const self = await srv.api('POST', '/api/challenges', { token: adaToken, body: { username: 'Ada_Ch', baseMs: 180000, incMs: 2000, color: 'w' } });
    assert.equal(self.status, 400);
    assert.match(self.json.error, /own account/);
    const missing = await srv.api('POST', '/api/challenges', { token: adaToken, body: { username: 'No_Such_Player', baseMs: 180000, incMs: 2000, color: 'w' } });
    assert.equal(missing.status, 404);
    const first = await srv.api('POST', '/api/challenges', { token: adaToken, body: { username: 'Bea_Ch', baseMs: 60000, incMs: 0, color: 'b' } });
    const second = await srv.api('POST', '/api/challenges', { token: adaToken, body: { username: 'Bea_Ch', baseMs: 180000, incMs: 2000, color: 'w' } });
    assert.equal(second.status, 200);
    assert.equal(second.json.username, 'Bea_Ch');
    assert.equal(second.json.color, 'w');
    assert.equal(second.json.clock, '3 + 2');
    const outgoing = await srv.api('GET', '/api/live', { token: adaToken });
    assert.equal(outgoing.json.game, null);
    assert.equal(outgoing.json.outgoing.length, 1);
    assert.equal(outgoing.json.outgoing[0].id, second.json.id);
    assert.notEqual(outgoing.json.outgoing[0].id, first.json.id);
    const incoming = await srv.api('GET', '/api/live', { token: beaToken });
    assert.equal(incoming.json.incoming.length, 1);
    assert.equal(incoming.json.incoming[0].username, 'Ada_Ch');
    assert.equal(incoming.json.incoming[0].color, 'w');
  });

  await test('declining removes the offer and accepting starts the requested colour', async () => {
    const listed = await srv.api('GET', '/api/live', { token: beaToken });
    const declined = await srv.api('POST', `/api/challenges/${listed.json.incoming[0].id}/decline`, { token: beaToken });
    assert.equal(declined.status, 200);
    assert.equal((await srv.api('GET', '/api/live', { token: adaToken })).json.outgoing.length, 0);
    const offer = await srv.api('POST', '/api/challenges', { token: adaToken, body: { username: 'Bea_Ch', baseMs: 180000, incMs: 2000, color: 'w' } });
    const accepted = await srv.api('POST', `/api/challenges/${offer.json.id}/accept`, { token: beaToken });
    assert.equal(accepted.status, 200);
    assert.equal(typeof accepted.json.gameId, 'string');
    const adaLive = await srv.api('GET', '/api/live', { token: adaToken });
    const beaLive = await srv.api('GET', '/api/live', { token: beaToken });
    assert.equal(adaLive.json.game.id, accepted.json.gameId);
    assert.equal(adaLive.json.game.opponent, 'Bea_Ch');
    assert.equal(beaLive.json.game.opponent, 'Ada_Ch');
    assert.equal(adaLive.json.outgoing.length, 0);
    assert.equal(beaLive.json.incoming.length, 0);
    const busy = await srv.api('POST', '/api/challenges', { token: cal.json.token, body: { username: 'Bea_Ch', baseMs: 60000, incMs: 0, color: 'random' } });
    assert.equal(busy.status, 400);
    assert.match(busy.json.error, /already in a game/);
    const hidden = await srv.api('GET', `/api/games/${accepted.json.gameId}`);
    assert.equal(hidden.status, 404);
  });

  await test('a disconnected player still has the live game, and a finished game can be opened', async () => {
    const gameId = (await srv.api('GET', '/api/live', { token: adaToken })).json.game.id;
    const white = await openSocket(srv.port, adaToken);
    const hello = await white.wait((msg) => msg.type === 'welcome');
    assert.equal(hello.game.id, gameId);
    assert.equal(hello.game.you, 'w');
    assert.equal(hello.game.white.username, 'Ada_Ch');
    assert.equal(hello.game.black.username, 'Bea_Ch');
    white.ws.close();
    const still = await srv.api('GET', '/api/live', { token: adaToken });
    assert.equal(still.json.game.id, gameId);
    const again = await openSocket(srv.port, adaToken);
    const resumed = await again.wait((msg) => msg.type === 'welcome');
    assert.equal(resumed.game.id, gameId);
    assert.equal(resumed.game.status, 'live');
    again.send({ type: 'move', gameId, uci: 'e2e4' });
    await again.wait((msg) => msg.type === 'game' && msg.game.game.uci.length === 1);
    again.send({ type: 'resign', gameId });
    await again.wait((msg) => msg.type === 'game' && msg.game.status === 'finished');
    const finished = await srv.api('GET', `/api/games/${gameId}`, { token: adaToken });
    assert.equal(finished.status, 200);
    assert.deepEqual(finished.json.game.uci, ['e2e4']);
    assert.equal(finished.json.result, '0-1');
    assert.equal(finished.json.reason, 'resignation');
    assert.equal(finished.json.you, 'w');
    assert.equal(finished.json.white, 'Ada_Ch');
    assert.equal(finished.json.black, 'Bea_Ch');
    const guest = await srv.api('GET', `/api/games/${gameId}`);
    assert.equal(guest.status, 200);
    assert.equal(guest.json.you, null);
    assert.equal(guest.json.review, null);
    const missing = await srv.api('GET', '/api/games/not-a-game');
    assert.equal(missing.status, 404);
    assert.equal((await srv.api('GET', '/api/live', { token: adaToken })).json.game, null);
    again.ws.close();
  });
} finally {
  await srv.close();
}

console.log(`\nChallenge tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
