// In-game chat starts only after a request is accepted. Off-game messages do too.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { createLive } from '../server/live.mjs';
import { startTestServer } from './server-harness.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ornate-chat-'));
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

function lastGame(player) {
  return [...player.inbox].reverse().find((msg) => msg.type === 'game').game;
}

function lastError(player) {
  return [...player.inbox].reverse().find((msg) => msg.type === 'error');
}

await test('in-game chat waits for the other player to accept', () => {
  const live = createLive(db);
  const white = seat('Ada');
  const black = seat('Bea');
  live.connect(white.user, white.send);
  live.connect(black.user, black.send);
  const t0 = 2_000_000;
  live.command(white.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'w' }, t0);
  live.command(black.user, { type: 'seek', baseMs: 60000, incMs: 0, color: 'b' }, t0);
  const gameId = lastGame(white).id;
  live.command(white.user, { type: 'chat', gameId, text: 'Hello before the request.' }, t0 + 10);
  assert.match(lastError(white).error, /Ask to chat/);
  live.command(white.user, { type: 'chat-request', gameId }, t0 + 20);
  assert.equal(lastGame(white).chat.state, 'requested');
  assert.equal(lastGame(white).chat.outgoing, true);
  assert.equal(lastGame(black).chat.outgoing, false);
  live.command(white.user, { type: 'chat-accept', gameId }, t0 + 30);
  assert.match(lastError(white).error, /no chat request/);
  live.command(black.user, { type: 'chat-accept', gameId }, t0 + 40);
  assert.equal(lastGame(white).chat.state, 'open');
  live.command(white.user, { type: 'chat', gameId, text: 'Good game.' }, t0 + 50);
  live.command(black.user, { type: 'chat', gameId, text: 'You too.' }, t0 + 500);
  const seen = lastGame(black).chat.messages;
  assert.equal(seen[0].yours, false);
  assert.equal(seen[0].text, 'Good game.');
  assert.equal(seen[1].yours, true);
  const stored = db.prepare('SELECT chat_status, chat_json FROM live_games WHERE id = ?').get(gameId);
  assert.equal(stored.chat_status, 'open');
  assert.equal(JSON.parse(stored.chat_json).length, 2);
  live.command(white.user, { type: 'chat', gameId, text: 'x'.repeat(241) }, t0 + 1000);
  assert.match(lastError(white).error, /240/);
});

await test('a declined in-game request cannot be repeated', () => {
  const live = createLive(db);
  const white = seat('Cy');
  const black = seat('Dee');
  live.connect(white.user, white.send);
  live.connect(black.user, black.send);
  const t0 = 3_000_000;
  live.command(white.user, { type: 'seek', baseMs: 180000, incMs: 2000, color: 'w' }, t0);
  live.command(black.user, { type: 'seek', baseMs: 180000, incMs: 2000, color: 'b' }, t0);
  const gameId = lastGame(white).id;
  live.command(black.user, { type: 'chat-request', gameId }, t0 + 10);
  live.command(white.user, { type: 'chat-decline', gameId }, t0 + 20);
  assert.equal(lastGame(black).chat.state, 'declined');
  live.command(black.user, { type: 'chat-request', gameId }, t0 + 30);
  assert.match(lastError(black).error, /declined/);
  live.command(white.user, { type: 'chat', gameId, text: 'Still there?' }, t0 + 40);
  assert.match(lastError(white).error, /Ask to chat/);
});

await test('off-game messages stay closed until the request is accepted', async () => {
  const srv = await startTestServer();
  try {
    const ada = await srv.api('POST', '/api/auth/register', { body: { username: 'ada_chat', password: 'correct-horse', email: 'ada_chat@example.com' } });
    const bea = await srv.api('POST', '/api/auth/register', { body: { username: 'bea_chat', password: 'correct-horse', email: 'bea_chat@example.com' } });
    const hidden = await srv.api('GET', '/api/messages');
    assert.equal(hidden.status, 401);
    const self = await srv.api('POST', '/api/messages/ada_chat', { token: ada.json.token, body: { text: 'Hello me.' } });
    assert.equal(self.status, 400);
    const sent = await srv.api('POST', '/api/messages/bea_chat', { token: ada.json.token, body: { text: 'Want to talk?' } });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.status, 'outgoing');
    const again = await srv.api('POST', '/api/messages/bea_chat', { token: ada.json.token, body: { text: 'Again.' } });
    assert.equal(again.status, 400);
    const incoming = await srv.api('GET', '/api/messages/ada_chat', { token: bea.json.token });
    assert.equal(incoming.json.status, 'incoming');
    assert.equal(incoming.json.messages[0].text, 'Want to talk?');
    assert.equal(incoming.json.messages[0].yours, false);
    const early = await srv.api('POST', '/api/messages/ada_chat', { token: bea.json.token, body: { text: 'Not yet.' } });
    assert.equal(early.status, 400);
    const accepted = await srv.api('POST', '/api/messages/ada_chat/accept', { token: bea.json.token });
    assert.equal(accepted.json.status, 'open');
    const reply = await srv.api('POST', '/api/messages/ada_chat', { token: bea.json.token, body: { text: 'Yes.' } });
    assert.equal(reply.status, 200);
    const inbox = await srv.api('GET', '/api/messages', { token: ada.json.token });
    assert.equal(inbox.json.threads[0].username, 'bea_chat');
    assert.equal(inbox.json.threads[0].status, 'open');
    assert.equal(inbox.json.threads[0].last, 'Yes.');
    assert.equal(inbox.json.threads[0].lastYours, false);
    assert.equal(typeof inbox.json.threads[0].lastAt, 'number');
    const cy = await srv.api('POST', '/api/auth/register', { body: { username: 'cy_chat', password: 'correct-horse', email: 'cy_chat@example.com' } });
    await srv.api('POST', '/api/messages/cy_chat', { token: ada.json.token, body: { text: 'Another note.' } });
    const declined = await srv.api('POST', '/api/messages/ada_chat/decline', { token: cy.json.token });
    assert.equal(declined.json.status, 'declined');
    const blocked = await srv.api('POST', '/api/messages/cy_chat', { token: ada.json.token, body: { text: 'Once more.' } });
    assert.equal(blocked.status, 400);
    const empty = await srv.api('POST', '/api/messages/bea_chat', { token: ada.json.token, body: { text: '   ' } });
    assert.equal(empty.status, 400);
  } finally {
    await srv.close();
  }
});

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nChat checks passed');
process.exit(failed ? 1 : 0);
