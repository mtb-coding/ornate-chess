// Public player pages and one-way follows. Ratings and finished games are visible.
// Cheat marks are not.
import { clockMark } from '../src/ui/clock.js';
import { PACES } from '../src/online-ratings.js';
import { PROVISIONAL_DEVIATION } from '../src/glicko.js';
import { HttpError } from './errors.mjs';

const USERNAME = /^[A-Za-z0-9_]{3,24}$/;
const FOLLOW_LIMIT = 200;
const PROFILE_GAMES = 12;
const FEED_GAMES = 15;

function checkUsername(username) {
  const name = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME.test(name)) {
    throw new HttpError(400, 'A username must be 3 to 24 characters and use only letters, numbers and underscores.');
  }
  return name;
}

function findUser(db, username) {
  const name = checkUsername(username);
  const row = db.prepare('SELECT id, username, created_at FROM users WHERE username_fold = ?').get(name.toLowerCase());
  if (!row) throw new HttpError(404, 'That player could not be found.');
  return row;
}

function paceView(row) {
  if (!row) return null;
  return {
    rating: Math.round(row.rating),
    provisional: row.deviation > PROVISIONAL_DEVIATION,
    games: row.games,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
  };
}

function ratingsFor(db, userId) {
  const rows = db.prepare(`SELECT pace, rating, deviation, games, wins, draws, losses
    FROM pace_ratings WHERE user_id = ?`).all(userId);
  const byPace = Object.fromEntries(rows.map((row) => [row.pace, row]));
  return Object.fromEntries(PACES.map((pace) => [pace, paceView(byPace[pace])]));
}

function outcome(result, side) {
  if (result === '1/2-1/2') return 'draw';
  if (result === '1-0') return side === 'w' ? 'win' : 'loss';
  if (result === '0-1') return side === 'b' ? 'win' : 'loss';
  return null;
}

function recentGames(db, userIds, limit) {
  if (!userIds.length) return [];
  const marks = userIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, white_id AS whiteId, black_id AS blackId,
      white_name AS whiteName, black_name AS blackName, result,
      result_reason AS reason, base_ms AS baseMs, inc_ms AS incMs, updated_at AS at
    FROM live_games
    WHERE status = 'finished' AND result IS NOT NULL
      AND (white_id IN (${marks}) OR black_id IN (${marks}))
    ORDER BY updated_at DESC
    LIMIT ${limit}`).all(...userIds, ...userIds);
  const wanted = new Set(userIds);
  const games = [];
  for (const row of rows) {
    const side = wanted.has(row.whiteId) ? 'w' : 'b';
    const result = outcome(row.result, side);
    if (!result) continue;
    const mark = clockMark(row.baseMs, row.incMs);
    games.push({
      id: row.id,
      player: side === 'w' ? row.whiteName : row.blackName,
      opponent: side === 'w' ? row.blackName : row.whiteName,
      outcome: result,
      reason: row.reason,
      pace: mark ? mark.pace : null,
      paceLabel: mark ? mark.paceLabel : 'Online',
      clock: mark ? mark.short : '',
      at: row.at,
    });
  }
  return games;
}

export function playerProfile(db, username, viewerId = null) {
  const user = findUser(db, username);
  const followers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followed_id = ?').get(user.id).n;
  const followingCount = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(user.id).n;
  let following = null;
  if (viewerId) {
    following = !!db.prepare('SELECT 1 AS ok FROM follows WHERE follower_id = ? AND followed_id = ?').get(viewerId, user.id);
  }
  return {
    username: user.username,
    you: viewerId === user.id,
    following,
    followers,
    followingCount,
    ratings: ratingsFor(db, user.id),
    games: recentGames(db, [user.id], PROFILE_GAMES),
  };
}

export function followPlayer(db, followerId, username, now = Date.now()) {
  const user = findUser(db, username);
  if (user.id === followerId) throw new HttpError(400, 'You cannot follow your own account.');
  const existing = db.prepare('SELECT 1 AS ok FROM follows WHERE follower_id = ? AND followed_id = ?').get(followerId, user.id);
  if (existing) return { following: true, username: user.username };
  const count = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(followerId).n;
  if (count >= FOLLOW_LIMIT) throw new HttpError(400, 'The following list is full.');
  db.prepare('INSERT INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)').run(followerId, user.id, now);
  return { following: true, username: user.username };
}

export function unfollowPlayer(db, followerId, username) {
  const user = findUser(db, username);
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(followerId, user.id);
  return { following: false, username: user.username };
}

export function followingFeed(db, userId) {
  const people = db.prepare(`SELECT u.id, u.username FROM follows f
    JOIN users u ON u.id = f.followed_id
    WHERE f.follower_id = ?
    ORDER BY u.username COLLATE NOCASE`).all(userId);
  return {
    players: people.map((person) => ({ username: person.username, ratings: ratingsFor(db, person.id) })),
    games: recentGames(db, people.map((person) => person.id), FEED_GAMES),
  };
}
