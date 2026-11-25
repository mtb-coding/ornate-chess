// Accounts and bearer sessions. The token itself is never stored.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { HttpError } from './errors.mjs';
import { sendMail } from './mail.mjs';

const ARGON = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_MS = 15 * 60 * 1000;
const CODE_GAP_MS = 30 * 1000;
const USERNAME = /^[A-Za-z0-9_]{3,24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let dummyHash = null;
const recoverGap = new Map();

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

function checkEmail(email) {
  const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!value || value.length > 254 || /[\r\n]/.test(value) || !EMAIL.test(value)) {
    throw new HttpError(400, 'Enter an email address.');
  }
  return value;
}

function maskEmail(email) {
  const at = email.indexOf('@');
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

function codeHash(code) {
  return createHash('sha256').update(code).digest('hex');
}

function storePending(db, userId, { email, nextHash, purpose, code, now, reuse = 0 }) {
  db.prepare(`INSERT INTO password_resets (user_id, email, code_hash, next_hash, expires_at, attempts, created_at, purpose, reuse)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(user_id, purpose) DO UPDATE SET
      email = excluded.email,
      code_hash = excluded.code_hash,
      next_hash = excluded.next_hash,
      expires_at = excluded.expires_at,
      attempts = 0,
      created_at = excluded.created_at,
      reuse = excluded.reuse`).run(userId, email, codeHash(code), nextHash, now + CODE_MS, now, purpose, reuse ? 1 : 0);
}

function assertCodeGap(db, userId, now) {
  const pending = db.prepare('SELECT MAX(created_at) AS created_at FROM password_resets WHERE user_id = ?').get(userId);
  if (pending && pending.created_at && now - pending.created_at < CODE_GAP_MS) {
    throw new HttpError(429, 'Wait a moment before asking for another code.');
  }
}

function dropPending(db, userId, purpose) {
  db.prepare('DELETE FROM password_resets WHERE user_id = ? AND purpose = ?').run(userId, purpose);
}

function pendingRow(db, userId, purpose, now) {
  const row = db.prepare('SELECT email, code_hash, next_hash, expires_at, attempts, purpose, reuse FROM password_resets WHERE user_id = ? AND purpose = ?').get(userId, purpose);
  if (!row) throw new HttpError(400, 'Ask for a confirmation code first.');
  if (row.expires_at <= now) {
    dropPending(db, userId, purpose);
    throw new HttpError(400, 'That confirmation code has expired. Ask for a new one.');
  }
  return row;
}

function acceptCode(db, userId, row, code) {
  if (!codesMatch(row.code_hash, code)) {
    const attempts = row.attempts + 1;
    if (attempts >= 5) {
      dropPending(db, userId, row.purpose);
      throw new HttpError(400, 'That confirmation code is no longer valid. Ask for a new one.');
    }
    db.prepare('UPDATE password_resets SET attempts = ? WHERE user_id = ? AND purpose = ?').run(attempts, userId, row.purpose);
    throw new HttpError(400, 'That confirmation code is not correct.');
  }
}

function codeFrom(body) {
  return body && typeof body.code === 'string' ? body.code.trim() : '';
}

function codesMatch(stored, code) {
  const left = Buffer.from(stored, 'hex');
  const right = createHash('sha256').update(code).digest();
  return left.length === right.length && timingSafeEqual(left, right);
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
  const email = checkEmail(body && body.email);
  const passwordHash = await hash(password, ARGON);
  const id = randomUUID();
  const createdAt = Date.now();
  try {
    db.prepare('INSERT INTO users (id, username, username_fold, password_hash, created_at, email, email_verified) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(id, username, username.toLowerCase(), passwordHash, createdAt, email);
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
    SELECT u.id, u.username, u.created_at, u.email, u.email_verified, s.id AS session_id, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash(match[1]));
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  return {
    ...publicUser(row),
    sessionId: row.session_id,
    email: row.email || '',
    emailVerified: row.email_verified === 1,
  };
}

export function logout(db, sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function recoverResponse() {
  return { status: 'pending', delivery: process.env.ORNATE_SMTP_HOST ? 'sent' : 'saved' };
}

function claimRecoverGap(db, usernameFold, userId, now) {
  const remembered = recoverGap.get(usernameFold) || 0;
  let stored = 0;
  if (userId) {
    const pending = db.prepare('SELECT MAX(created_at) AS created_at FROM password_resets WHERE user_id = ?').get(userId);
    stored = pending && pending.created_at ? pending.created_at : 0;
  }
  if (now - Math.max(remembered, stored) < CODE_GAP_MS) {
    throw new HttpError(429, 'Wait a moment before asking for another code.');
  }
  recoverGap.set(usernameFold, now);
}

export async function requestPasswordChange(db, userId, body, now = Date.now(), options = {}) {
  const current = checkPassword(body && body.current);
  const next = checkPassword(body && body.next);
  if (current === next) {
    throw new HttpError(400, 'Choose a password that is different from the current one.');
  }
  const row = db.prepare('SELECT username, password_hash, email, email_verified FROM users WHERE id = ?').get(userId);
  if (!row) throw new HttpError(401, 'The current password is not correct.');
  const matches = await verify(row.password_hash, current);
  if (!matches) throw new HttpError(401, 'The current password is not correct.');
  const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
  if (!email) {
    throw new HttpError(400, 'This account has no email address, so the password cannot be changed.');
  }
  if (body && typeof body.email === 'string' && body.email.trim() && checkEmail(body.email) !== email) {
    throw new HttpError(400, 'The confirmation code is sent to the email saved when the account was created.');
  }
  assertCodeGap(db, userId, now);
  const nextHash = await hash(next, ARGON);
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  storePending(db, userId, { email, nextHash, purpose: 'password', code, now });
  try {
    const sent = await sendMail({
      to: email,
      subject: 'Confirm your Ornate Chess password change',
      text: [
        `Someone asked to change the password for the Ornate Chess account ${row.username}.`,
        '',
        `The confirmation code is ${code}.`,
        '',
        'It expires in 15 minutes. If you did not ask for this, you can ignore this message. The password has not changed.',
      ].join('\n'),
    });
    const response = { status: 'pending', email: maskEmail(email), delivery: sent.delivery };
    if (options.preview && sent.delivery === 'saved') response.preview = code;
    return response;
  } catch (err) {
    dropPending(db, userId, 'password');
    throw err;
  }
}

export function confirmPasswordChange(db, userId, body, now = Date.now(), sessionId = '') {
  const row = pendingRow(db, userId, 'password', now);
  acceptCode(db, userId, row, codeFrom(body));
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(row.next_hash, userId);
    dropPending(db, userId, 'password');
    if (sessionId) db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, sessionId);
    else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* The transaction may already be closed. */ }
    throw err;
  }
  return { ok: true };
}

export async function requestPasswordRecovery(db, body, now = Date.now()) {
  const username = checkUsername(body && body.username);
  const next = checkPassword(body && body.next);
  const supplied = body && typeof body.email === 'string' && body.email.trim() ? checkEmail(body.email) : '';
  const fold = username.toLowerCase();
  const row = db.prepare('SELECT id, username, password_hash, email FROM users WHERE username_fold = ?').get(fold);
  const email = row && typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
  claimRecoverGap(db, fold, row ? row.id : '', now);
  const nextHash = await hash(next, ARGON);
  if (!row || !email || (supplied && supplied !== email)) return recoverResponse();
  const same = await verify(row.password_hash, next);
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  storePending(db, row.id, {
    email,
    nextHash: same ? row.password_hash : nextHash,
    purpose: 'recover',
    code,
    now,
    reuse: same ? 1 : 0,
  });
  try {
    await sendMail({
      to: email,
      subject: 'Reset your Ornate Chess password',
      text: [
        `Someone asked to reset the password for the Ornate Chess account ${row.username}.`,
        '',
        `The confirmation code is ${code}.`,
        '',
        'It expires in 15 minutes. If you did not ask for this, you can ignore this message. The password has not changed.',
      ].join('\n'),
    });
    return recoverResponse();
  } catch (err) {
    dropPending(db, row.id, 'recover');
    throw err;
  }
}

export function confirmPasswordRecovery(db, body, now = Date.now()) {
  const username = checkUsername(body && body.username);
  const rowUser = db.prepare('SELECT id FROM users WHERE username_fold = ?').get(username.toLowerCase());
  if (!rowUser) throw new HttpError(400, 'That confirmation code is not correct.');
  const row = pendingRow(db, rowUser.id, 'recover', now);
  acceptCode(db, rowUser.id, row, codeFrom(body));
  if (row.reuse) {
    dropPending(db, rowUser.id, 'recover');
    throw new HttpError(400, 'Choose a password that is different from the current one.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(row.next_hash, rowUser.id);
    dropPending(db, rowUser.id, 'recover');
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(rowUser.id);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* The transaction may already be closed. */ }
    throw err;
  }
  return { ok: true };
}

export async function requestEmailChange(db, userId, body, now = Date.now(), options = {}) {
  const current = checkPassword(body && body.current);
  const nextEmail = checkEmail(body && body.email);
  const row = db.prepare('SELECT username, password_hash, email FROM users WHERE id = ?').get(userId);
  if (!row) throw new HttpError(401, 'The current password is not correct.');
  const matches = await verify(row.password_hash, current);
  if (!matches) throw new HttpError(401, 'The current password is not correct.');
  const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
  if (!email) throw new HttpError(400, 'This account has no email address, so the address cannot be changed.');
  if (nextEmail === email) throw new HttpError(400, 'That is already the email on this account.');
  assertCodeGap(db, userId, now);
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  storePending(db, userId, { email: nextEmail, nextHash: row.password_hash, purpose: 'email', code, now });
  try {
    const sent = await sendMail({
      to: email,
      subject: 'Confirm your Ornate Chess email change',
      text: [
        `Someone asked to change the email for the Ornate Chess account ${row.username}.`,
        '',
        `The confirmation code is ${code}.`,
        '',
        'It expires in 15 minutes. If you did not ask for this, you can ignore this message. The email has not changed.',
      ].join('\n'),
    });
    const response = { status: 'pending', email: maskEmail(email), delivery: sent.delivery };
    if (options.preview && sent.delivery === 'saved') response.preview = code;
    return response;
  } catch (err) {
    dropPending(db, userId, 'email');
    throw err;
  }
}

export function confirmEmailChange(db, userId, body, now = Date.now()) {
  const row = pendingRow(db, userId, 'email', now);
  acceptCode(db, userId, row, codeFrom(body));
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?').run(row.email, userId);
    dropPending(db, userId, 'email');
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* The transaction may already be closed. */ }
    throw err;
  }
  return { ok: true, email: row.email };
}

export async function confirmPassword(db, userId, password) {
  const secret = checkPassword(password);
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!row) throw new HttpError(401, 'The password is not correct.');
  const matches = await verify(row.password_hash, secret);
  if (!matches) throw new HttpError(401, 'The password is not correct.');
}

export function removeAccount(db, userId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE live_games SET white_name = 'Deleted player' WHERE white_id = ?`).run(userId);
    db.prepare(`UPDATE live_games SET black_name = 'Deleted player' WHERE black_id = ?`).run(userId);
    const empty = db.prepare(`SELECT id, game_json, status FROM live_games WHERE white_id = ? OR black_id = ?`).all(userId, userId);
    const deleteJob = db.prepare(`DELETE FROM jobs WHERE kind = 'review' AND json_extract(payload_json, '$.gameId') = ?`);
    const deleteGame = db.prepare('DELETE FROM live_games WHERE id = ?');
    for (const game of empty) {
      let moves = 1;
      try { moves = JSON.parse(game.game_json).uci.length; } catch { moves = 1; }
      if (game.status === 'aborted' || moves === 0) {
        deleteJob.run(game.id);
        deleteGame.run(game.id);
      }
    }
    db.prepare('DELETE FROM pace_ratings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM game_puzzles WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM cheat_flags WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* The transaction may already be closed. */ }
    throw err;
  }
}
