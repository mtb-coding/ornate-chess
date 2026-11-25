// Off-game messages. The first message is a request. The other player accepts
// before either person can send another.
import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.mjs';

const USERNAME = /^[A-Za-z0-9_]{3,24}$/;
const TEXT_MAX = 500;
const THREAD_CAP = 100;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 30;

function checkUsername(username) {
  const name = typeof username === 'string' ? decodeURIComponentSafe(username).trim() : '';
  if (!USERNAME.test(name)) {
    throw new HttpError(400, 'A username must be 3 to 24 characters and use only letters, numbers and underscores.');
  }
  return name;
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function checkText(text) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body || body.length > TEXT_MAX) {
    throw new HttpError(400, 'A message must be 1 to 500 characters.');
  }
  return body;
}

function findUser(db, username) {
  const name = checkUsername(username);
  const row = db.prepare('SELECT id, username FROM users WHERE username_fold = ?').get(name.toLowerCase());
  if (!row) throw new HttpError(404, 'That player could not be found.');
  return row;
}

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function findThread(db, leftId, rightId) {
  const [userA, userB] = pair(leftId, rightId);
  return db.prepare('SELECT * FROM message_threads WHERE user_a = ? AND user_b = ?').get(userA, userB) || null;
}

function viewerStatus(thread, userId) {
  if (!thread) return 'none';
  if (thread.status === 'open') return 'open';
  if (thread.status === 'declined') return 'declined';
  return thread.requested_by === userId ? 'outgoing' : 'incoming';
}

function publicMessages(db, threadId, userId) {
  const rows = db.prepare(`SELECT sender_id, body, created_at FROM direct_messages
    WHERE thread_id = ? ORDER BY created_at DESC LIMIT 50`).all(threadId).reverse();
  return rows.map((row) => ({ yours: row.sender_id === userId, text: row.body, at: row.created_at }));
}

function assertRate(db, userId, now) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE sender_id = ? AND created_at > ?')
    .get(userId, now - RATE_WINDOW_MS).n;
  if (count >= RATE_MAX) throw new HttpError(429, 'Wait a moment before sending another message.');
}

export function listThreads(db, userId) {
  const rows = db.prepare(`
    SELECT t.id, t.user_a, t.user_b, t.status, t.requested_by, t.updated_at,
      CASE WHEN t.user_a = ? THEN ub.username ELSE ua.username END AS username,
      (SELECT body FROM direct_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body
    FROM message_threads t
    JOIN users ua ON ua.id = t.user_a
    JOIN users ub ON ub.id = t.user_b
    WHERE t.user_a = ? OR t.user_b = ?
    ORDER BY t.updated_at DESC
    LIMIT 50
  `).all(userId, userId, userId);
  return {
    threads: rows.map((row) => ({
      username: row.username,
      status: viewerStatus(row, userId),
      last: row.last_body || '',
      updatedAt: row.updated_at,
    })),
  };
}

export function readThread(db, userId, username) {
  const other = findUser(db, username);
  if (other.id === userId) throw new HttpError(400, 'You cannot message your own account.');
  const thread = findThread(db, userId, other.id);
  return {
    username: other.username,
    status: viewerStatus(thread, userId),
    messages: thread ? publicMessages(db, thread.id, userId) : [],
  };
}

export function sendMessage(db, userId, username, text, now = Date.now()) {
  const body = checkText(text);
  const other = findUser(db, username);
  if (other.id === userId) throw new HttpError(400, 'You cannot message your own account.');
  assertRate(db, userId, now);
  const thread = findThread(db, userId, other.id);
  if (thread && thread.status === 'declined') throw new HttpError(400, 'This player has declined messages.');
  if (thread && thread.status === 'requested' && thread.requested_by === userId) {
    throw new HttpError(400, 'Wait for them to accept before sending another message.');
  }
  if (thread && thread.status === 'requested') {
    throw new HttpError(400, 'Accept the request before you reply.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    let threadId = thread && thread.id;
    let status = 'open';
    if (!thread) {
      const [userA, userB] = pair(userId, other.id);
      threadId = randomUUID();
      db.prepare(`INSERT INTO message_threads (
        id, user_a, user_b, status, requested_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'requested', ?, ?, ?)`).run(threadId, userA, userB, userId, now, now);
      status = 'outgoing';
    } else {
      db.prepare('UPDATE message_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
    }
    db.prepare('INSERT INTO direct_messages (id, thread_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), threadId, userId, body, now);
    db.prepare(`DELETE FROM direct_messages WHERE thread_id = ? AND id NOT IN (
      SELECT id FROM direct_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ${THREAD_CAP}
    )`).run(threadId, threadId);
    db.exec('COMMIT');
    return { username: other.username, status };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function answer(db, userId, username, next, now) {
  const other = findUser(db, username);
  const thread = findThread(db, userId, other.id);
  if (!thread || thread.status !== 'requested' || thread.requested_by === userId) {
    throw new HttpError(400, 'There is no message request to answer.');
  }
  db.prepare('UPDATE message_threads SET status = ?, updated_at = ? WHERE id = ?').run(next, now, thread.id);
  return { username: other.username, status: next === 'open' ? 'open' : 'declined' };
}

export function acceptMessage(db, userId, username, now = Date.now()) {
  return answer(db, userId, username, 'open', now);
}

export function declineMessage(db, userId, username, now = Date.now()) {
  return answer(db, userId, username, 'declined', now);
}
