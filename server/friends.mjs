// Mutual friends. A request waits until the other player accepts.
import { HttpError } from './errors.mjs';

const USERNAME = /^[A-Za-z0-9_]{3,24}$/;
const SEARCH = /^[A-Za-z0-9_]{2,24}$/;
const FRIEND_LIMIT = 200;
const REQUEST_LIMIT = 30;
const SEARCH_LIMIT = 20;

function checkUsername(username) {
  const name = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME.test(name)) {
    throw new HttpError(400, 'A username must be 3 to 24 characters and use only letters, numbers and underscores.');
  }
  return name;
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

function rowFor(db, a, b) {
  const [low, high] = pair(a, b);
  return db.prepare('SELECT user_low, user_high, requested_by, status FROM friendships WHERE user_low = ? AND user_high = ?').get(low, high);
}

function acceptedCount(db, userId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM friendships
    WHERE status = 'accepted' AND (user_low = ? OR user_high = ?)`).get(userId, userId).n;
}

function assertRoom(db, ...ids) {
  for (const id of ids) {
    if (acceptedCount(db, id) >= FRIEND_LIMIT) throw new HttpError(400, 'The friend list is full.');
  }
}

export function friendState(db, viewerId, otherId) {
  if (!viewerId || viewerId === otherId) return null;
  const row = rowFor(db, viewerId, otherId);
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requested_by === viewerId ? 'outgoing' : 'incoming';
}

function otherName(db, userId, row) {
  const otherId = row.user_low === userId ? row.user_high : row.user_low;
  const other = db.prepare('SELECT username FROM users WHERE id = ?').get(otherId);
  return other ? other.username : '';
}

export function listFriends(db, userId) {
  const rows = db.prepare(`SELECT user_low, user_high, requested_by, status FROM friendships
    WHERE user_low = ? OR user_high = ?`).all(userId, userId);
  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const row of rows) {
    const username = otherName(db, userId, row);
    if (!username) continue;
    const item = { username };
    if (row.status === 'accepted') friends.push(item);
    else if (row.requested_by === userId) outgoing.push(item);
    else incoming.push(item);
  }
  const byName = (a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
  friends.sort(byName);
  incoming.sort(byName);
  outgoing.sort(byName);
  return { friends, incoming, outgoing };
}

export function searchPlayers(db, userId, query) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!SEARCH.test(q)) throw new HttpError(400, 'Enter at least two letters, numbers or underscores.');
  const like = `${q.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = db.prepare(`SELECT id, username FROM users
    WHERE username_fold LIKE ? ESCAPE '\\' AND id != ?
    ORDER BY username_fold LIMIT ?`).all(like, userId, SEARCH_LIMIT);
  return {
    players: rows.map((row) => ({ username: row.username, friend: friendState(db, userId, row.id) })),
  };
}

export function requestFriend(db, userId, username, now = Date.now()) {
  const other = findUser(db, username);
  if (other.id === userId) throw new HttpError(400, 'You cannot send a friend request to your own account.');
  const existing = rowFor(db, userId, other.id);
  if (existing && existing.status === 'accepted') throw new HttpError(400, 'You are already friends.');
  if (existing && existing.requested_by === userId) throw new HttpError(400, 'A friend request is already waiting.');
  if (existing) {
    assertRoom(db, userId, other.id);
    const [low, high] = pair(userId, other.id);
    db.prepare(`UPDATE friendships SET status = 'accepted', updated_at = ? WHERE user_low = ? AND user_high = ?`).run(now, low, high);
    return { friend: 'friends', username: other.username };
  }
  assertRoom(db, userId);
  const waiting = db.prepare(`SELECT COUNT(*) AS n FROM friendships WHERE status = 'pending' AND requested_by = ?`).get(userId).n;
  if (waiting >= REQUEST_LIMIT) throw new HttpError(400, 'You have too many friend requests waiting.');
  const [low, high] = pair(userId, other.id);
  db.prepare(`INSERT INTO friendships (user_low, user_high, requested_by, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)`).run(low, high, userId, now, now);
  return { friend: 'outgoing', username: other.username };
}

export function acceptFriend(db, userId, username, now = Date.now()) {
  const other = findUser(db, username);
  const row = rowFor(db, userId, other.id);
  if (!row || row.status !== 'pending' || row.requested_by === userId) {
    throw new HttpError(404, 'That friend request could not be found.');
  }
  assertRoom(db, userId, other.id);
  const [low, high] = pair(userId, other.id);
  db.prepare(`UPDATE friendships SET status = 'accepted', updated_at = ? WHERE user_low = ? AND user_high = ?`).run(now, low, high);
  return { friend: 'friends', username: other.username };
}

export function declineFriend(db, userId, username) {
  const other = findUser(db, username);
  const row = rowFor(db, userId, other.id);
  if (!row || row.status !== 'pending') throw new HttpError(404, 'That friend request could not be found.');
  const [low, high] = pair(userId, other.id);
  db.prepare('DELETE FROM friendships WHERE user_low = ? AND user_high = ?').run(low, high);
  return { friend: 'none', username: other.username };
}

export function removeFriend(db, userId, username) {
  const other = findUser(db, username);
  const row = rowFor(db, userId, other.id);
  if (!row || row.status !== 'accepted') throw new HttpError(404, 'That player is not on your friend list.');
  const [low, high] = pair(userId, other.id);
  db.prepare('DELETE FROM friendships WHERE user_low = ? AND user_high = ?').run(low, high);
  return { friend: 'none', username: other.username };
}
