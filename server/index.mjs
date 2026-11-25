// Local Ornate Chess API and live-game socket. Start: node server/index.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { confirmEmailChange, confirmPassword, confirmPasswordChange, confirmPasswordRecovery, login, logout, register, removeAccount, requestEmailChange, requestPasswordChange, requestPasswordRecovery, userFromAuthorization } from './auth.mjs';
import { readRatings } from './ratings.mjs';
import { DEFAULT_DB_PATH, openDatabase } from './db.mjs';
import { HttpError } from './errors.mjs';
import { createLive } from './live.mjs';
import { leaderboard, submitAppeal } from './cheat.mjs';
import { listGamePuzzles, readGameReview, updateGamePuzzle } from './reviews.mjs';
import { acceptChallenge, createChallenge, declineChallenge, listChallenges } from './challenges.mjs';
import { followPlayer, followingFeed, playerProfile, readFinishedGame, unfollowPlayer } from './social.mjs';
import { acceptFriend, declineFriend, listFriends, removeFriend, requestFriend, searchPlayers } from './friends.mjs';
import { acceptMessage, declineMessage, listThreads, readThread, sendMessage } from './messages.mjs';
import { getSync, putSync } from './sync.mjs';

export const ALLOWED_ORIGINS = new Set([
  'http://localhost:8002',
  'http://127.0.0.1:8002',
  'http://localhost:8477',
  'http://127.0.0.1:8477',
  'https://ornate-chess.netlify.app',
]);

const MAX_AUTH_BYTES = 32 * 1024;
const MAX_SYNC_BYTES = 8 * 1024 * 1024;

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!ALLOWED_ORIGINS.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  return true;
}

function send(res, status, body) {
  if (res.writableEnded) return;
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
  });
  res.end(json);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
      req.destroy();
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(new HttpError(413, 'The request is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

async function readJson(req, limit) {
  const text = await readBody(req, limit);
  if (!text.trim()) throw new HttpError(400, 'The request body is empty.');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, 'The request body must be a JSON object.');
    }
    return value;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

function requireUser(db, req) {
  const user = userFromAuthorization(db, req.headers.authorization);
  if (!user) throw new HttpError(401, 'A valid session token is required.');
  return user;
}

async function handle(req, res, db, hub) {
  if (!applyCors(req, res)) {
    send(res, 403, { error: 'That origin is not allowed to call this API.' });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathName = url.pathname;
  if (req.method === 'GET' && pathName === '/api/health') {
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/register') {
    send(res, 200, await register(db, await readJson(req, MAX_AUTH_BYTES)));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/login') {
    send(res, 200, await login(db, await readJson(req, MAX_AUTH_BYTES)));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/logout') {
    const user = requireUser(db, req);
    logout(db, user.sessionId);
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/password') {
    const user = requireUser(db, req);
    send(res, 200, await requestPasswordChange(db, user.id, await readJson(req, MAX_AUTH_BYTES)));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/password/confirm') {
    const user = requireUser(db, req);
    send(res, 200, confirmPasswordChange(db, user.id, await readJson(req, MAX_AUTH_BYTES)));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/recover') {
    send(res, 200, await requestPasswordRecovery(db, await readJson(req, MAX_AUTH_BYTES)));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/recover/confirm') {
    send(res, 200, confirmPasswordRecovery(db, await readJson(req, MAX_AUTH_BYTES)));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/email') {
    const user = requireUser(db, req);
    send(res, 200, await requestEmailChange(db, user.id, await readJson(req, MAX_AUTH_BYTES)));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/email/confirm') {
    const user = requireUser(db, req);
    send(res, 200, confirmEmailChange(db, user.id, await readJson(req, MAX_AUTH_BYTES)));
    return;
  }
  if (req.method === 'GET' && pathName === '/api/live') {
    const user = requireUser(db, req);
    send(res, 200, { game: hub.activeSummary(user.id), ...listChallenges(db, user.id) });
    return;
  }
  if (req.method === 'POST' && pathName === '/api/challenges') {
    const user = requireUser(db, req);
    send(res, 200, createChallenge(db, hub, user, await readJson(req, MAX_AUTH_BYTES)));
    return;
  }
  const challengePath = /^\/api\/challenges\/([^/]+)\/(accept|decline)$/.exec(pathName);
  if (req.method === 'POST' && challengePath) {
    const user = requireUser(db, req);
    const id = decodeURIComponent(challengePath[1]);
    const result = challengePath[2] === 'accept'
      ? acceptChallenge(db, hub, user, id)
      : declineChallenge(db, user, id);
    send(res, 200, result);
    return;
  }
  const gamePath = /^\/api\/games\/([^/]+)$/.exec(pathName);
  if (req.method === 'GET' && gamePath) {
    const user = userFromAuthorization(db, req.headers.authorization);
    send(res, 200, readFinishedGame(db, decodeURIComponent(gamePath[1]), user && user.id));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/auth/delete') {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_AUTH_BYTES);
    await confirmPassword(db, user.id, body && body.password);
    if (hub) hub.retire(user.id);
    removeAccount(db, user.id);
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === 'GET' && pathName === '/api/ratings') {
    const user = requireUser(db, req);
    send(res, 200, { ratings: readRatings(db, user.id) });
    return;
  }
  if (req.method === 'GET' && pathName === '/api/auth/me') {
    const user = requireUser(db, req);
    send(res, 200, { user: { id: user.id, username: user.username, createdAt: user.createdAt, email: user.email || '', emailVerified: Boolean(user.emailVerified) } });
    return;
  }
  if (req.method === 'GET' && pathName === '/api/sync') {
    const user = requireUser(db, req);
    send(res, 200, getSync(db, user.id));
    return;
  }
  if (req.method === 'PUT' && pathName === '/api/sync') {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_SYNC_BYTES);
    putSync(db, user.id, body.entries);
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === 'GET' && pathName === '/api/leaderboard') {
    const user = userFromAuthorization(db, req.headers.authorization);
    send(res, 200, leaderboard(db, url.searchParams.get('pace'), user && user.id));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/appeals') {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_AUTH_BYTES);
    send(res, 200, { appeal: submitAppeal(db, { userId: user.id, pace: body.pace, note: body.note }) });
    return;
  }
  if (req.method === 'GET' && pathName === '/api/following') {
    const user = requireUser(db, req);
    send(res, 200, followingFeed(db, user.id));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/follow') {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_AUTH_BYTES);
    send(res, 200, followPlayer(db, user.id, body.username));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/unfollow') {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_AUTH_BYTES);
    send(res, 200, unfollowPlayer(db, user.id, body.username));
    return;
  }
  if (req.method === 'GET' && pathName === '/api/friends') {
    const user = requireUser(db, req);
    send(res, 200, listFriends(db, user.id));
    return;
  }
  if (req.method === 'GET' && pathName === '/api/friends/search') {
    const user = requireUser(db, req);
    send(res, 200, searchPlayers(db, user.id, url.searchParams.get('q')));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/friends/request') {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_AUTH_BYTES);
    send(res, 200, requestFriend(db, user.id, body.username));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/friends/accept') {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_AUTH_BYTES);
    send(res, 200, acceptFriend(db, user.id, body.username));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/friends/decline') {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_AUTH_BYTES);
    send(res, 200, declineFriend(db, user.id, body.username));
    return;
  }
  if (req.method === 'POST' && pathName === '/api/friends/remove') {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_AUTH_BYTES);
    send(res, 200, removeFriend(db, user.id, body.username));
    return;
  }
  if (req.method === 'GET' && pathName === '/api/messages') {
    const user = requireUser(db, req);
    send(res, 200, listThreads(db, user.id));
    return;
  }
  const messageAnswer = /^\/api\/messages\/([^/]+)\/(accept|decline)$/.exec(pathName);
  if (req.method === 'POST' && messageAnswer) {
    const user = requireUser(db, req);
    const username = decodeURIComponent(messageAnswer[1]);
    const result = messageAnswer[2] === 'accept'
      ? acceptMessage(db, user.id, username)
      : declineMessage(db, user.id, username);
    send(res, 200, result);
    return;
  }
  const messagePath = /^\/api\/messages\/([^/]+)$/.exec(pathName);
  if (messagePath && (req.method === 'GET' || req.method === 'POST')) {
    const user = requireUser(db, req);
    const username = decodeURIComponent(messagePath[1]);
    if (req.method === 'GET') {
      send(res, 200, readThread(db, user.id, username));
      return;
    }
    const body = await readJson(req, MAX_AUTH_BYTES);
    send(res, 200, sendMessage(db, user.id, username, body.text));
    return;
  }
  const playerPath = /^\/api\/players\/([^/]+)$/.exec(pathName);
  if (req.method === 'GET' && playerPath) {
    const user = userFromAuthorization(db, req.headers.authorization);
    send(res, 200, playerProfile(db, decodeURIComponent(playerPath[1]), user && user.id));
    return;
  }
  if (req.method === 'GET' && pathName === '/api/puzzles') {
    const user = requireUser(db, req);
    send(res, 200, { puzzles: listGamePuzzles(db, user.id) });
    return;
  }
  const puzzlePath = /^\/api\/puzzles\/([^/]+)$/.exec(pathName);
  if (req.method === 'POST' && puzzlePath) {
    const user = requireUser(db, req);
    const body = await readJson(req, MAX_AUTH_BYTES);
    const puzzle = updateGamePuzzle(db, user.id, decodeURIComponent(puzzlePath[1]), body);
    send(res, 200, { puzzle });
    return;
  }
  const reviewPath = /^\/api\/reviews\/([^/]+)$/.exec(pathName);
  if (req.method === 'GET' && reviewPath) {
    const user = requireUser(db, req);
    send(res, 200, readGameReview(db, decodeURIComponent(reviewPath[1]), user.id));
    return;
  }
  if (pathName.startsWith('/api/')) {
    send(res, 404, { error: 'That address is not part of the API.' });
    return;
  }
  send(res, 404, { error: 'That address is not part of the API.' });
}

const MAX_SOCKET_BYTES = 16 * 1024;

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function attachSocket(ws, db, hub) {
  let user = null;
  let sendFn = null;
  const helloTimer = setTimeout(() => { if (!user) ws.close(); }, 5000);
  helloTimer.unref?.();
  ws.on('message', (data, isBinary) => {
    if (isBinary || data.length > MAX_SOCKET_BYTES) {
      safeSend(ws, { type: 'error', error: 'The message is too large.' });
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch {
      safeSend(ws, { type: 'error', error: 'The message is not valid JSON.' });
      return;
    }
    if (!user) {
      if (!msg || msg.type !== 'hello' || typeof msg.token !== 'string') {
        safeSend(ws, { type: 'error', error: 'Sign in before using the game server.' });
        ws.close();
        return;
      }
      user = userFromAuthorization(db, `Bearer ${msg.token}`);
      if (!user) {
        safeSend(ws, { type: 'error', error: 'The session is not valid. Sign in again.' });
        ws.close();
        return;
      }
      clearTimeout(helloTimer);
      sendFn = (payload) => safeSend(ws, payload);
      hub.connect(user, sendFn, () => { try { ws.close(); } catch { /* The socket may already be closed. */ } });
      return;
    }
    try { hub.command(user, msg, Date.now()); } catch (err) {
      console.error(err);
      safeSend(ws, { type: 'error', error: 'The server could not complete that action.' });
    }
  });
  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (user && sendFn) hub.disconnect(user.id, sendFn);
  });
}

export function createServer({ db, port = 0, host = '127.0.0.1' }) {
  if (!db) throw new Error('createServer requires a database.');
  const hub = createLive(db);
  const server = http.createServer((req, res) => {
    handle(req, res, db, hub).catch((err) => {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
        return;
      }
      console.error(err);
      send(res, 500, { error: 'The server could not complete the request.' });
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    let pathName = '';
    try { pathName = new URL(req.url, 'http://127.0.0.1').pathname; } catch { socket.destroy(); return; }
    if (pathName !== '/ws') { socket.destroy(); return; }
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => attachSocket(ws, db, hub));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      server.on('error', (err) => console.error(err));
      const timer = setInterval(() => hub.tick(Date.now()), 250);
      timer.unref?.();
      const address = server.address();
      resolve({
        server,
        port: address.port,
        hub,
        close: () => new Promise((done, fail) => {
          clearInterval(timer);
          for (const client of wss.clients) client.terminate();
          wss.close();
          server.close((err) => (err ? fail(err) : done()));
        }),
      });
    });
  });
}

function isDirectRun() {
  const self = fileURLToPath(import.meta.url);
  const arg = process.argv[1];
  return Boolean(arg) && path.resolve(arg) === path.resolve(self);
}

if (isDirectRun()) {
  const port = Number(process.env.PORT || 8488);
  const host = process.env.HOST || '127.0.0.1';
  const file = process.env.ORNATE_DB || DEFAULT_DB_PATH;
  const db = openDatabase(file);
  try {
    const running = await createServer({ db, port, host });
    console.log(`Ornate Chess API is listening on http://${host}:${running.port}/`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
