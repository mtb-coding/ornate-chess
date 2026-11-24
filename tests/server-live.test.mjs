// Live games: pairing, moves, clock, draws and disconnects.
// Run: node tests/server-live.test.mjs
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.mjs';
import { ABORT_GRACE_MS, FORFEIT_GRACE_MS, assignColors, colorsFit, createLive } from '../server/live.mjs';
import { readRatings } from '../server/ratings.mjs';
import { startTestServer } from './server-harness.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.stack || err)); }
}

function seat(name) {
  const inbox = [];
  return { user: { id: name, username: name }, inbox, send(msg) { inbox.push(msg); } };
}

function last(player, type) {
  for (let i = player.inbox.length - 1; i >= 0; i--) if (!type || player.inbox[i].type === type) return player.inbox[i];
  return null;
}

test('colour pairing keeps a requested side and gives the waiting player White when both are random', () => {
  assert.equal(colorsFit('w', 'w'), false);
  assert.equal(colorsFit('w', 'b'), true);
  assert.equal(colorsFit('random', 'w'), true);
  const waiting = { userId: 'a', color: 'random' };
  const joining = { userId: 'b', color: 'w' };
  assert.equal(assignColors(waiting, joining).white.userId, 'b');
  assert.equal(assignColors({ userId: 'a', color: 'random' }, { userId: 'b', color: 'random' }).white.userId, 'a');
});

test('two players are paired, a move is checked, and the clock gains its increment', () => {
  const db = openDatabase(':memory:');
  const live = createLive(db);
  const white = seat('Ada');
  const black = seat('Bea');
  live.connect(white.user, white.send);
  live.connect(black.user, black.send);
  const t0 = 1_000_000;
  live.command(white.user, { type: 'seek', baseMs: 180000, incMs: 2000, color: 'w' }, t0);
  assert.equal(last(white, 'seeking').seek.label, '3 minutes plus 2 seconds per move');
  live.command(black.user, { type: 'seek', baseMs: 180000, incMs: 2000, color: 'b' }, t0);
  const game = last(white, 'game').game;
  assert.equal(game.you, 'w');
  assert.equal(last(black, 'game').game.you, 'b');
  assert.equal(game.white.username, 'Ada');
  live.command(black.user, { type: 'move', gameId: game.id, uci: 'e7e5' }, t0 + 500);
  assert.match(last(black, 'error').error, /not your turn/);
  live.command(white.user, { type: 'move', gameId: game.id, uci: 'e2e5' }, t0 + 500);
  assert.match(last(white, 'error').error, /not legal/);
  live.command(white.user, { type: 'move', gameId: game.id, uci: 'e2e4' }, t0 + 1000);
  const after = last(black, 'game').game;
  assert.deepEqual(after.game.uci, ['e2e4']);
  assert.equal(after.wMs, 181000);
  assert.equal(after.bMs, 180000);
  db.close();
});

test('the same requested colour does not match, and an unknown time control is refused', () => {
  const db = openDatabase(':memory:');
  const live = createLive(db);
  const a = seat('Cara');
  const b = seat('Dina');
  live.connect(a.user, a.send);
  live.connect(b.user, b.send);
  live.command(a.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'w' }, 10);
  live.command(b.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'w' }, 20);
  assert.equal(last(a, 'game'), null);
  assert.equal(last(b, 'seeking').seek.color, 'w');
  live.command(a.user, { type: 'seek', baseMs: 1000, incMs: 0, color: 'random' }, 30);
  assert.match(last(a, 'error').error, /listed time controls/);
  db.close();
});

test('checkmate, resignation and an agreed draw finish the game', () => {
  const db = openDatabase(':memory:');
  const live = createLive(db);
  const white = seat('Eve');
  const black = seat('Fay');
  live.connect(white.user, white.send);
  live.connect(black.user, black.send);
  const t0 = 5_000;
  live.command(white.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'w' }, t0);
  live.command(black.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'random' }, t0);
  const id = last(white, 'game').game.id;
  const play = (user, uci, at) => live.command(user, { type: 'move', gameId: id, uci }, at);
  play(white.user, 'f2f3', t0 + 1);
  play(black.user, 'e7e5', t0 + 2);
  play(white.user, 'g2g4', t0 + 3);
  play(black.user, 'd8h4', t0 + 4);
  assert.equal(last(white, 'game').game.result, '0-1');
  assert.equal(last(white, 'game').game.resultReason, 'checkmate');
  assert.equal(last(white, 'game').game.status, 'finished');

  const g = seat('Gia');
  const h = seat('Hana');
  live.connect(g.user, g.send);
  live.connect(h.user, h.send);
  live.command(g.user, { type: 'seek', baseMs: 300000, incMs: 0, color: 'w' }, t0);
  live.command(h.user, { type: 'seek', baseMs: 300000, incMs: 0, color: 'b' }, t0);
  const id2 = last(g, 'game').game.id;
  live.command(g.user, { type: 'resign', gameId: id2 }, t0 + 50);
  assert.equal(last(h, 'game').game.result, '0-1');
  assert.equal(last(h, 'game').game.resultReason, 'resignation');

  const i = seat('Ivy');
  const j = seat('Joy');
  live.connect(i.user, i.send);
  live.connect(j.user, j.send);
  live.command(i.user, { type: 'seek', baseMs: 300000, incMs: 3000, color: 'b' }, t0);
  live.command(j.user, { type: 'seek', baseMs: 300000, incMs: 3000, color: 'w' }, t0);
  const seated = last(i, 'game').game;
  assert.equal(seated.you, 'b');
  const id3 = seated.id;
  live.command(j.user, { type: 'draw', gameId: id3 }, t0 + 10);
  assert.equal(last(i, 'game').game.drawOffer, 'w');
  live.command(i.user, { type: 'decline', gameId: id3 }, t0 + 11);
  assert.equal(last(j, 'game').game.drawOffer, null);
  live.command(i.user, { type: 'draw', gameId: id3 }, t0 + 12);
  live.command(j.user, { type: 'draw', gameId: id3 }, t0 + 13);
  assert.equal(last(i, 'game').game.result, '1/2-1/2');
  assert.equal(last(i, 'game').game.resultReason, 'agreement');
  db.close();
});

test('a clock flags the side to move, and a late move does not count', () => {
  const db = openDatabase(':memory:');
  const live = createLive(db);
  const white = seat('Kim');
  const black = seat('Lia');
  live.connect(white.user, white.send);
  live.connect(black.user, black.send);
  const t0 = 10_000;
  live.command(white.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'w' }, t0);
  live.command(black.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'b' }, t0);
  const id = last(white, 'game').game.id;
  live.tick(t0 + 60000);
  const flagged = last(black, 'game').game;
  assert.equal(flagged.result, '0-1');
  assert.equal(flagged.resultReason, 'timeout');
  assert.equal(flagged.wMs, 0);
  live.command(white.user, { type: 'move', gameId: id, uci: 'e2e4' }, t0 + 60001);
  assert.match(last(white, 'error').error, /not the one you are playing/);
  db.close();
});

test('leaving before a move cancels the game, and leaving later forfeits it', () => {
  const db = openDatabase(':memory:');
  const live = createLive(db);
  const white = seat('Mia');
  const black = seat('Nia');
  live.connect(white.user, white.send);
  live.connect(black.user, black.send);
  const t0 = 50_000;
  live.command(white.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'random' }, t0);
  live.command(black.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'random' }, t0);
  assert.equal(last(white, 'game').game.you, 'w');
  live.disconnect(black.user.id, black.send, t0 + 1000);
  assert.equal(last(white, 'game').game.opponentConnected, false);
  live.tick(t0 + 1000 + ABORT_GRACE_MS);
  assert.match(last(white, 'aborted').error, /cancelled before any moves/);

  const p = seat('Ora');
  const q = seat('Pia');
  live.connect(p.user, p.send);
  live.connect(q.user, q.send);
  live.command(p.user, { type: 'seek', baseMs: 300000, incMs: 0, color: 'w' }, t0);
  live.command(q.user, { type: 'seek', baseMs: 300000, incMs: 0, color: 'b' }, t0);
  const id = last(p, 'game').game.id;
  live.command(p.user, { type: 'move', gameId: id, uci: 'e2e4' }, t0 + 100);
  live.disconnect(p.user.id, p.send, t0 + 200);
  live.tick(t0 + 200 + FORFEIT_GRACE_MS);
  const ended = last(q, 'game').game;
  assert.equal(ended.result, '0-1');
  assert.equal(ended.resultReason, 'disconnect');
  db.close();
});

test('a finished game updates only its pace, and an abort does not', () => {
  const db = openDatabase(':memory:');
  const live = createLive(db);
  const white = seat('RaeW');
  const black = seat('SueB');
  live.connect(white.user, white.send);
  live.connect(black.user, black.send);
  assert.equal(last(white, 'welcome').ratings.blitz.rating, 1500);
  assert.equal(last(white, 'welcome').ratings.blitz.games, 0);
  const t0 = 80_000;

  live.command(white.user, { type: 'seek', baseMs: 180000, incMs: 2000, color: 'w' }, t0);
  live.command(black.user, { type: 'seek', baseMs: 180000, incMs: 2000, color: 'b' }, t0);
  live.disconnect(black.user.id, black.send, t0 + 1000);
  live.tick(t0 + 1000 + ABORT_GRACE_MS);
  assert.match(last(white, 'aborted').error, /cancelled before any moves/);
  assert.equal(readRatings(db, 'RaeW').blitz.games, 0);
  live.connect(black.user, black.send);

  live.command(white.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'w' }, t0 + 30000);
  live.command(black.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'b' }, t0 + 30000);
  const bulletId = last(white, 'game').game.id;
  const play = (user, uci, at) => live.command(user, { type: 'move', gameId: bulletId, uci }, at);
  play(white.user, 'f2f3', t0 + 30001);
  play(black.user, 'e7e5', t0 + 30002);
  play(white.user, 'g2g4', t0 + 30003);
  play(black.user, 'd8h4', t0 + 30004);
  const bullet = last(white, 'game').game;
  assert.equal(bullet.result, '0-1');
  assert.equal(bullet.rating.pace, 'bullet');
  assert.ok(bullet.rating.delta < 0, String(bullet.rating.delta));
  assert.ok(last(black, 'game').game.rating.delta > 0);
  assert.equal(readRatings(db, 'RaeW').bullet.games, 1);
  assert.equal(readRatings(db, 'RaeW').bullet.losses, 1);
  assert.equal(readRatings(db, 'SueB').bullet.wins, 1);
  assert.equal(readRatings(db, 'SueB').bullet.black.wins, 1);
  assert.ok(readRatings(db, 'RaeW').bullet.rating < 1500);
  assert.ok(readRatings(db, 'SueB').bullet.rating > 1500);
  assert.ok(readRatings(db, 'RaeW').bullet.deviation < 350);
  assert.equal(readRatings(db, 'RaeW').blitz.games, 0);
  assert.equal(readRatings(db, 'RaeW').rapid.games, 0);

  live.command(white.user, { type: 'seek', baseMs: 300000, incMs: 0, color: 'w' }, t0 + 40000);
  live.command(black.user, { type: 'seek', baseMs: 300000, incMs: 0, color: 'b' }, t0 + 40000);
  const blitzId = last(white, 'game').game.id;
  live.command(white.user, { type: 'move', gameId: blitzId, uci: 'e2e4' }, t0 + 40010);
  live.command(white.user, { type: 'resign', gameId: blitzId }, t0 + 40020);
  assert.equal(last(black, 'game').game.rating.pace, 'blitz');
  assert.ok(last(black, 'game').game.rating.delta > 0);
  assert.equal(readRatings(db, 'RaeW').blitz.games, 1);
  assert.equal(readRatings(db, 'RaeW').bullet.games, 1);

  live.command(white.user, { type: 'seek', baseMs: 600000, incMs: 5000, color: 'w' }, t0 + 50000);
  live.command(black.user, { type: 'seek', baseMs: 600000, incMs: 5000, color: 'b' }, t0 + 50000);
  const rapidId = last(white, 'game').game.id;
  live.command(white.user, { type: 'move', gameId: rapidId, uci: 'd2d4' }, t0 + 50010);
  live.command(black.user, { type: 'resign', gameId: rapidId }, t0 + 50020);
  assert.equal(last(white, 'game').game.rating.pace, 'rapid');
  assert.ok(last(white, 'game').game.rating.delta > 0);
  assert.equal(readRatings(db, 'RaeW').rapid.white.wins, 1);
  assert.equal(readRatings(db, 'SueB').rapid.losses, 1);

  live.command(white.user, { type: 'seek', baseMs: 300000, incMs: 0, color: 'w' }, t0 + 60000);
  live.command(black.user, { type: 'seek', baseMs: 300000, incMs: 0, color: 'b' }, t0 + 60000);
  const bareId = last(white, 'game').game.id;
  live.command(white.user, { type: 'resign', gameId: bareId }, t0 + 60010);
  assert.equal(last(white, 'game').game.result, '0-1');
  assert.equal(last(white, 'game').game.rating, null);
  assert.equal(readRatings(db, 'RaeW').blitz.games, 1);
  db.close();
});

test('cancelling a search does not start a game', () => {
  const db = openDatabase(':memory:');
  const live = createLive(db);
  const a = seat('Quin');
  live.connect(a.user, a.send);
  live.command(a.user, { type: 'seek', baseMs: 900000, incMs: 10000, color: 'random' }, 1);
  live.command(a.user, { type: 'cancel' }, 2);
  assert.equal(last(a).type, 'cancelled');
  const b = seat('Rae');
  live.connect(b.user, b.send);
  live.command(b.user, { type: 'seek', baseMs: 900000, incMs: 10000, color: 'random' }, 3);
  assert.equal(last(b).type, 'seeking');
  db.close();
});

await test('a socket session can sign in, match and play a move', async () => {
  const srv = await startTestServer();
  try {
    const ada = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_Live', password: 'correct-horse' } });
    const bea = await srv.api('POST', '/api/auth/register', { body: { username: 'Bea_Live', password: 'correct-horse' } });
    assert.equal(ada.status, 200);
    const open = (token) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
      const inbox = [];
      const pending = [];
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        const waiter = pending.shift();
        if (waiter) waiter(msg);
        else inbox.push(msg);
      });
      ws.addEventListener('error', () => reject(new Error('The socket failed.')));
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'hello', token }));
        resolve({
          ws,
          send(obj) { ws.send(JSON.stringify(obj)); },
          next(ms = 2000) {
            if (inbox.length) return Promise.resolve(inbox.shift());
            return new Promise((done, fail) => {
              const timer = setTimeout(() => fail(new Error('The socket sent no message.')), ms);
              pending.push((msg) => { clearTimeout(timer); done(msg); });
            });
          },
        });
      });
    });
    const bad = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const refused = await new Promise((resolve) => {
      bad.addEventListener('message', (ev) => resolve(JSON.parse(ev.data)));
      bad.addEventListener('open', () => bad.send(JSON.stringify({ type: 'hello', token: 'not-a-session' })));
    });
    assert.match(refused.error, /not valid/);
    bad.close();

    const a = await open(ada.json.token);
    const hello = await a.next();
    assert.equal(hello.type, 'welcome');
    assert.equal(hello.user.username, 'Ada_Live');
    const b = await open(bea.json.token);
    await b.next();
    a.send({ type: 'seek', baseMs: 60000, incMs: 0, color: 'w' });
    assert.equal((await a.next()).type, 'seeking');
    b.send({ type: 'seek', baseMs: 60000, incMs: 0, color: 'b' });
    const matched = await b.next();
    assert.equal(matched.type, 'game');
    const seen = await a.next();
    assert.equal(seen.type, 'game');
    a.send({ type: 'move', gameId: seen.game.id, uci: 'e2e4' });
    const moved = await b.next();
    assert.deepEqual(moved.game.game.uci, ['e2e4']);
    a.ws.close();
    b.ws.close();
  } finally {
    await srv.close();
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
