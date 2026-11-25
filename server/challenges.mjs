// A direct offer of one clock to one player. The game starts only when that player accepts.
import { randomUUID } from 'node:crypto';
import { CLOCK_PRESETS, clockMark } from '../src/ui/clock.js';
import { HttpError } from './errors.mjs';

const USERNAME = /^[A-Za-z0-9_]{3,24}$/;
const CHALLENGE_MS = 15 * 60 * 1000;
const TIME_CONTROLS = CLOCK_PRESETS.filter((preset) => preset.baseMs > 0);

function checkUsername(username) {
  const name = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME.test(name)) {
    throw new HttpError(400, 'A username must be 3 to 24 characters and use only letters, numbers and underscores.');
  }
  return name;
}

function presetFor(baseMs, incMs) {
  if (!Number.isInteger(baseMs) || !Number.isInteger(incMs)) return null;
  return TIME_CONTROLS.find((preset) => preset.baseMs === baseMs && preset.incMs === incMs) || null;
}

function dropExpired(db, now) {
  db.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(now);
}

function view(row, userId) {
  const incoming = row.to_id === userId;
  const mark = clockMark(row.base_ms, row.inc_ms);
  return {
    id: row.id,
    username: incoming ? row.from_name : row.to_name,
    color: row.color,
    baseMs: row.base_ms,
    incMs: row.inc_ms,
    clock: mark ? mark.short : '',
    paceLabel: mark ? mark.paceLabel : 'Online',
  };
}

export function listChallenges(db, userId, now = Date.now()) {
  dropExpired(db, now);
  const rows = db.prepare(`SELECT id, from_id, to_id, from_name, to_name, base_ms, inc_ms, color
    FROM challenges WHERE from_id = ? OR to_id = ? ORDER BY created_at DESC`).all(userId, userId);
  return {
    incoming: rows.filter((row) => row.to_id === userId).map((row) => view(row, userId)),
    outgoing: rows.filter((row) => row.from_id === userId).map((row) => view(row, userId)),
  };
}

export function createChallenge(db, hub, fromUser, body, now = Date.now()) {
  const username = checkUsername(body && body.username);
  const target = db.prepare('SELECT id, username FROM users WHERE username_fold = ?').get(username.toLowerCase());
  if (!target) throw new HttpError(404, 'That player could not be found.');
  if (target.id === fromUser.id) throw new HttpError(400, 'You cannot challenge your own account.');
  const preset = presetFor(body && body.baseMs, body && body.incMs);
  if (!preset) throw new HttpError(400, 'Choose one of the listed time controls.');
  const color = body && body.color;
  if (color !== 'w' && color !== 'b' && color !== 'random') throw new HttpError(400, 'Choose White, Black or Random.');
  if (hub.activeSummary(fromUser.id)) {
    throw new HttpError(400, 'You are already in a game. Finish it or resign before starting another.');
  }
  if (hub.activeSummary(target.id)) throw new HttpError(400, 'That player is already in a game.');
  dropExpired(db, now);
  const id = randomUUID();
  db.prepare('DELETE FROM challenges WHERE from_id = ?').run(fromUser.id);
  db.prepare(`INSERT INTO challenges (id, from_id, to_id, from_name, to_name, base_ms, inc_ms, color, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, fromUser.id, target.id, fromUser.username, target.username, preset.baseMs, preset.incMs, color, now, now + CHALLENGE_MS,
  );
  return view({
    id,
    from_id: fromUser.id,
    to_id: target.id,
    from_name: fromUser.username,
    to_name: target.username,
    base_ms: preset.baseMs,
    inc_ms: preset.incMs,
    color,
  }, fromUser.id);
}

function loadChallenge(db, id, now) {
  dropExpired(db, now);
  const row = db.prepare(`SELECT id, from_id, to_id, from_name, to_name, base_ms, inc_ms, color, expires_at
    FROM challenges WHERE id = ?`).get(id);
  if (!row) throw new HttpError(404, 'That offer could not be found.');
  return row;
}

export function acceptChallenge(db, hub, user, id, now = Date.now()) {
  const row = loadChallenge(db, id, now);
  if (row.to_id !== user.id) throw new HttpError(404, 'That offer could not be found.');
  const started = hub.startPaired(
    { id: row.from_id, username: row.from_name },
    { id: user.id, username: user.username },
    { baseMs: row.base_ms, incMs: row.inc_ms, color: row.color },
    now,
  );
  if (started.error) throw new HttpError(400, started.error);
  db.prepare('DELETE FROM challenges WHERE id = ? OR from_id = ? OR to_id = ? OR from_id = ? OR to_id = ?').run(
    row.id, row.from_id, row.from_id, row.to_id, row.to_id,
  );
  return { ok: true, gameId: started.id };
}

export function declineChallenge(db, user, id, now = Date.now()) {
  const row = loadChallenge(db, id, now);
  if (row.to_id !== user.id && row.from_id !== user.id) throw new HttpError(404, 'That offer could not be found.');
  db.prepare('DELETE FROM challenges WHERE id = ?').run(row.id);
  return { ok: true };
}
