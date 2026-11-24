// Accounts and bearer sessions. The token itself is never stored.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { HttpError } from './errors.mjs';

const ARGON = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME = /^[A-Za-z0-9_]{3,24}$/;

let dummyHash = null;

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function checkUsername(username) {
  const name = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME.test(name)) {
    throw new HttpError(400, 'A username must be 3 to 24 characters and use only letters, numbers and underscores.');
  }
  return name;
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'A password must be 8 to 128 characters.');
  }
  return password;
}

async function dummyPasswordHash() {
  if (!dummyHash) dummyHash = await hash('ornate-chess-dummy-password', ARGON);
  return dummyHash;
}

function publicUser(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

function issueSession(db, userId, now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), userId, tokenHash(token), now + SESSION_MS);
  return token;
}

export async function register(db, body) {
  const username = checkUsername(body && body.username);
  const password = checkPassword(body && body.password);
  const passwordHash = await hash(password, ARGON);
  const id = randomUUID();
  const createdAt = Date.now();
  try {
    db.prepare('INSERT INTO users (id, username, username_fold, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, username, username.toLowerCase(), passwordHash, createdAt);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      throw new HttpError(409, 'That username is already in use.');
    }
    throw err;
  }
  return { token: issueSession(db, id, createdAt), user: { id, username, createdAt } };
}

export async function login(db, body) {
  const username = checkUsername(body && body.username);
  const password = checkPassword(body && body.password);
  const row = db.prepare('SELECT id, username, password_hash, created_at FROM users WHERE username_fold = ?')
    .get(username.toLowerCase());
  const passwordHash = row ? row.password_hash : await dummyPasswordHash();
  const matches = await verify(passwordHash, password);
  if (!row || !matches) throw new HttpError(401, 'The username or password is not correct.');
  return { token: issueSession(db, row.id), user: publicUser(row) };
}

export function userFromAuthorization(db, header, now = Date.now()) {
  const match = typeof header === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  if (!match) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.created_at, s.id AS session_id, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash(match[1]));
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  return { ...publicUser(row), sessionId: row.session_id };
}

export function logout(db, sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}
