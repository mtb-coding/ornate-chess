// Live games. The server checks every move and owns the Fischer clock.
// Sockets stay in server/index.mjs; this module only keeps the rules.
import { randomUUID } from 'node:crypto';
import { Game } from '../src/engine.js';
import { CLOCK_PRESETS } from '../src/ui/clock.js';
import { applyUci, clockAfterMove } from './moves.mjs';
import { enqueueJob } from './jobs.mjs';
import { paceForClock, rateGame, readRatings } from './ratings.mjs';

export const ABORT_GRACE_MS = 20_000;
export const FORFEIT_GRACE_MS = 60_000;
const CHAT_LIMIT = 40;
const CHAT_TEXT_MAX = 240;
const CHAT_GAP_MS = 400;
const RECENT_MS = 2 * 60 * 1000;

const TIME_CONTROLS = CLOCK_PRESETS.filter((preset) => preset.baseMs > 0);

export function colorsFit(a, b) {
  if (a === 'random' || b === 'random') return true;
  return a !== b;
}

/** The player who has been waiting keeps a requested colour. Both random gives the waiting player White. */
export function assignColors(waiting, joining) {
  if (waiting.color === 'w' || joining.color === 'b') return { white: waiting, black: joining };
  if (waiting.color === 'b' || joining.color === 'w') return { white: joining, black: waiting };
  return { white: waiting, black: joining };
}

function presetFor(baseMs, incMs) {
  if (!Number.isInteger(baseMs) || !Number.isInteger(incMs)) return null;
  return TIME_CONTROLS.find((preset) => preset.baseMs === baseMs && preset.incMs === incMs) || null;
}

function parseGame(json) {
  return Game.fromJSON(typeof json === 'string' ? JSON.parse(json) : json);
}

function chatFrom(stored) {
  let messages = [];
  try {
    const value = JSON.parse((stored && stored.chat_json) || '[]');
    if (Array.isArray(value)) messages = value;
  } catch { messages = []; }
  return {
    chatStatus: stored && stored.chat_status ? stored.chat_status : 'closed',
    chatBy: stored && stored.chat_by ? stored.chat_by : null,
    chatMessages: messages.filter((entry) => entry && typeof entry.text === 'string' && typeof entry.by === 'string').slice(-CHAT_LIMIT),
  };
}

function moveTimesFrom(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    if (!Array.isArray(value)) return [];
    return value.map((ms) => (Number.isFinite(Number(ms)) && Number(ms) >= 0 ? Math.round(Number(ms)) : null));
  } catch {
    return [];
  }
}

export function createLive(db) {
  const games = new Map();
  const byUser = new Map();
  const seeks = new Map();
  const sockets = new Map();
  const disconnectedAt = new Map();

  const persist = db.prepare(`
    INSERT INTO live_games (
      id, base_ms, inc_ms, white_id, black_id, white_name, black_name,
      game_json, w_ms, b_ms, turn_started_at, status, result, result_reason,
      draw_offer, created_at, updated_at, move_times_json, chat_status, chat_by, chat_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      game_json = excluded.game_json,
      w_ms = excluded.w_ms,
      b_ms = excluded.b_ms,
      turn_started_at = excluded.turn_started_at,
      status = excluded.status,
      result = excluded.result,
      result_reason = excluded.result_reason,
      draw_offer = excluded.draw_offer,
      updated_at = excluded.updated_at,
      move_times_json = excluded.move_times_json,
      chat_status = excluded.chat_status,
      chat_by = excluded.chat_by,
      chat_json = excluded.chat_json
  `);
  const recentStmt = db.prepare(`
    SELECT * FROM live_games
    WHERE status = 'finished' AND updated_at >= ? AND (white_id = ? OR black_id = ?)
    ORDER BY updated_at DESC LIMIT 1
  `);

  function remember(row) {
    games.set(row.id, row);
    if (row.status === 'live') {
      byUser.set(row.whiteId, row.id);
      byUser.set(row.blackId, row.id);
    }
  }

  function forgetActive(row) {
    if (byUser.get(row.whiteId) === row.id) byUser.delete(row.whiteId);
    if (byUser.get(row.blackId) === row.id) byUser.delete(row.blackId);
    games.delete(row.id);
  }

  function gameFor(userId) {
    const id = byUser.get(userId);
    const row = id ? games.get(id) : null;
    return row && row.status === 'live' ? row : null;
  }

  function sideOf(row, userId) {
    if (row.whiteId === userId) return 'w';
    if (row.blackId === userId) return 'b';
    return null;
  }

  function opponentId(row, userId) {
    return row.whiteId === userId ? row.blackId : row.whiteId;
  }

  function save(row) {
    persist.run(
      row.id, row.baseMs, row.incMs, row.whiteId, row.blackId, row.whiteName, row.blackName,
      row.gameJson, row.wMs, row.bMs, row.turnStartedAt, row.status, row.result, row.resultReason,
      row.drawOffer, row.createdAt, row.updatedAt, JSON.stringify(row.moveTimes || []),
      row.chatStatus || 'closed', row.chatBy || null, JSON.stringify(row.chatMessages || []),
    );
  }

  function view(row, userId, now) {
    const you = sideOf(row, userId);
    const other = opponentId(row, userId);
    return {
      id: row.id,
      baseMs: row.baseMs,
      incMs: row.incMs,
      white: { id: row.whiteId, username: row.whiteName },
      black: { id: row.blackId, username: row.blackName },
      you,
      game: JSON.parse(row.gameJson),
      wMs: row.wMs,
      bMs: row.bMs,
      turnStartedAt: row.turnStartedAt,
      serverNow: now,
      status: row.status,
      result: row.result,
      resultReason: row.resultReason,
      drawOffer: row.drawOffer,
      opponentConnected: sockets.has(other),
      rating: row.ratingFor && row.ratingFor[userId] ? row.ratingFor[userId] : null,
      chat: {
        state: row.chatStatus || 'closed',
        outgoing: row.chatBy === userId,
        messages: (row.chatMessages || []).map((entry) => ({
          yours: entry.by === userId,
          text: entry.text,
          at: entry.at,
        })),
      },
    };
  }

  function send(userId, payload) {
    const seat = sockets.get(userId);
    if (!seat) return;
    try { seat.send(payload); } catch { /* The socket layer drops a closed connection. */ }
  }

  function broadcast(row, now) {
    send(row.whiteId, { type: 'game', game: view(row, row.whiteId, now) });
    send(row.blackId, { type: 'game', game: view(row, row.blackId, now) });
  }

  function finish(row, game, now) {
    const info = game.result();
    const json = game.toJSON();
    if (info && !json.resultInfo) json.resultInfo = { result: info.result, reason: info.reason, ply: game.length };
    row.gameJson = JSON.stringify(json);
    row.status = 'finished';
    row.result = info ? info.result : null;
    row.resultReason = info ? info.reason : null;
    row.turnStartedAt = null;
    row.drawOffer = null;
    row.updatedAt = now;
    row.ply = game.length;
    save(row);
    const pace = row.ply >= 1 ? paceForClock(row.baseMs, row.incMs) : null;
    if (pace && row.result) {
      try {
        row.ratingFor = rateGame(db, {
          pace,
          whiteId: row.whiteId,
          blackId: row.blackId,
          result: row.result,
          now,
          whiteName: row.whiteName,
          blackName: row.blackName,
        });
      } catch (err) {
        console.error('[rating]', err && err.message ? err.message : err);
        row.ratingFor = null;
      }
    }
    if (row.ply >= 1) {
      try {
        enqueueJob(db, { kind: 'review', payload: { gameId: row.id }, now });
      } catch (err) {
        console.error('[jobs]', err && err.message ? err.message : err);
      }
    }
    broadcast(row, now);
    forgetActive(row);
  }

  function stopClock(row, now) {
    if (row.turnStartedAt == null) return;
    const elapsed = Math.max(0, now - row.turnStartedAt);
    const key = row.turn === 'w' ? 'wMs' : 'bMs';
    row[key] = Math.max(0, row[key] - elapsed);
    row.turnStartedAt = null;
  }

  function abort(row, now) {
    row.status = 'aborted';
    row.turnStartedAt = null;
    row.updatedAt = now;
    save(row);
    const payload = { type: 'aborted', gameId: row.id, error: 'The game was cancelled before any moves were played.' };
    send(row.whiteId, payload);
    send(row.blackId, payload);
    forgetActive(row);
  }

  function flag(row, now) {
    const elapsed = Math.max(0, now - row.turnStartedAt);
    const clock = clockAfterMove({ wMs: row.wMs, bMs: row.bMs, incMs: row.incMs, turn: row.turn, elapsedMs: elapsed });
    row.wMs = clock.wMs;
    row.bMs = clock.bMs;
    const game = parseGame(row.gameJson);
    game.timeout(row.turn);
    finish(row, game, now);
  }

  function loadActive(now) {
    const rows = db.prepare(`SELECT * FROM live_games WHERE status = 'live'`).all();
    for (const stored of rows) {
      let parsed;
      try { parsed = JSON.parse(stored.game_json); } catch { continue; }
      const game = Game.fromJSON(parsed);
      const row = {
        id: stored.id,
        baseMs: stored.base_ms,
        incMs: stored.inc_ms,
        whiteId: stored.white_id,
        blackId: stored.black_id,
        whiteName: stored.white_name,
        blackName: stored.black_name,
        gameJson: stored.game_json,
        wMs: stored.w_ms,
        bMs: stored.b_ms,
        turnStartedAt: stored.turn_started_at,
        status: 'live',
        result: null,
        resultReason: null,
        drawOffer: stored.draw_offer,
        createdAt: stored.created_at,
        updatedAt: stored.updated_at,
        turn: game.turn,
        ply: game.length,
        moveTimes: moveTimesFrom(stored.move_times_json),
        ...chatFrom(stored),
      };
      remember(row);
      disconnectedAt.set(row.whiteId, now);
      disconnectedAt.set(row.blackId, now);
    }
  }

  function recentFor(userId, now) {
    const stored = recentStmt.get(now - RECENT_MS, userId, userId);
    if (!stored) return null;
    return {
      id: stored.id,
      baseMs: stored.base_ms,
      incMs: stored.inc_ms,
      whiteId: stored.white_id,
      blackId: stored.black_id,
      whiteName: stored.white_name,
      blackName: stored.black_name,
      gameJson: stored.game_json,
      wMs: stored.w_ms,
      bMs: stored.b_ms,
      turnStartedAt: null,
      status: 'finished',
      result: stored.result,
      resultReason: stored.result_reason,
      drawOffer: null,
      createdAt: stored.created_at,
      updatedAt: stored.updated_at,
      ...chatFrom(stored),
    };
  }

  loadActive(Date.now());

  function fail(userId, error) {
    send(userId, { type: 'error', error });
  }

  function startGame(waiting, joining, now) {
    const seats = assignColors(waiting, joining);
    const game = new Game();
    const row = {
      id: randomUUID(),
      baseMs: waiting.baseMs,
      incMs: waiting.incMs,
      whiteId: seats.white.userId,
      blackId: seats.black.userId,
      whiteName: seats.white.username,
      blackName: seats.black.username,
      gameJson: JSON.stringify(game.toJSON()),
      wMs: waiting.baseMs,
      bMs: waiting.baseMs,
      turnStartedAt: now,
      status: 'live',
      result: null,
      resultReason: null,
      drawOffer: null,
      createdAt: now,
      updatedAt: now,
      turn: 'w',
      ply: 0,
      moveTimes: [],
      chatStatus: 'closed',
      chatBy: null,
      chatMessages: [],
    };
    remember(row);
    save(row);
    broadcast(row, now);
  }

  function handleChat(row, userId, msg, now) {
    if (row.status !== 'live') {
      fail(userId, 'Chat is only available during the game.');
      return;
    }
    if (!Array.isArray(row.chatMessages)) row.chatMessages = [];
    if (msg.type === 'chat-request') {
      if (row.chatStatus === 'open') { fail(userId, 'Chat is already open.'); return; }
      if (row.chatStatus === 'declined') { fail(userId, 'Chat was declined for this game.'); return; }
      if (row.chatStatus === 'requested') { fail(userId, 'A chat request is already waiting.'); return; }
      row.chatStatus = 'requested';
      row.chatBy = userId;
      row.updatedAt = now;
      save(row);
      broadcast(row, now);
      return;
    }
    if (msg.type === 'chat-accept' || msg.type === 'chat-decline') {
      if (row.chatStatus !== 'requested' || row.chatBy === userId) {
        fail(userId, 'There is no chat request to answer.');
        return;
      }
      row.chatStatus = msg.type === 'chat-accept' ? 'open' : 'declined';
      row.updatedAt = now;
      save(row);
      broadcast(row, now);
      return;
    }
    if (row.chatStatus !== 'open') {
      fail(userId, 'Ask to chat, and wait for the other player to accept.');
      return;
    }
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    if (!text || text.length > CHAT_TEXT_MAX) {
      fail(userId, 'A chat message must be 1 to 240 characters.');
      return;
    }
    if (row.chatMessages.length >= CHAT_LIMIT) {
      fail(userId, 'This chat is full.');
      return;
    }
    const last = row.chatMessages[row.chatMessages.length - 1];
    if (last && last.by === userId && now - last.at < CHAT_GAP_MS) {
      fail(userId, 'Wait a moment before sending another message.');
      return;
    }
    row.chatMessages.push({ by: userId, text, at: now });
    row.updatedAt = now;
    save(row);
    broadcast(row, now);
  }

  return {
    connect(user, sendFn) {
      const prev = sockets.get(user.id);
      sockets.set(user.id, { send: sendFn, user });
      disconnectedAt.delete(user.id);
      if (prev && prev.send !== sendFn) {
        try {
          prev.send({ type: 'error', error: 'This account is open in another window. This window was disconnected.' });
        } catch { /* The previous socket may already be closed. */ }
      }
      const live = gameFor(user.id);
      const now = Date.now();
      if (live) broadcast(live, now);
      const recent = live ? null : recentFor(user.id, now);
      sendFn({
        type: 'welcome',
        user: { id: user.id, username: user.username },
        game: live ? view(live, user.id, now) : null,
        recent: recent ? view(recent, user.id, now) : null,
        ratings: readRatings(db, user.id),
      });
    },

    disconnect(userId, sendFn, now = Date.now()) {
      const seat = sockets.get(userId);
      if (!seat || seat.send !== sendFn) return;
      sockets.delete(userId);
      seeks.delete(userId);
      const row = gameFor(userId);
      if (!row) return;
      disconnectedAt.set(userId, now);
      broadcast(row, now);
    },

    command(user, msg, now = Date.now()) {
      if (!msg || typeof msg !== 'object') {
        fail(user.id, 'The message is not valid.');
        return;
      }
      if (msg.type === 'seek') {
        const row = gameFor(user.id);
        if (row) {
          fail(user.id, 'You are already in a game. Finish it or resign before starting another.');
          return;
        }
        const preset = presetFor(msg.baseMs, msg.incMs);
        if (!preset) {
          fail(user.id, 'Choose one of the listed time controls.');
          return;
        }
        if (msg.color !== 'w' && msg.color !== 'b' && msg.color !== 'random') {
          fail(user.id, 'Choose White, Black or Random.');
          return;
        }
        const mine = { userId: user.id, username: user.username, baseMs: preset.baseMs, incMs: preset.incMs, color: msg.color, label: preset.label };
        const waiting = [...seeks.values()].find((seek) => seek.userId !== user.id && seek.baseMs === mine.baseMs && seek.incMs === mine.incMs && colorsFit(seek.color, mine.color));
        seeks.delete(user.id);
        if (!waiting) {
          seeks.set(user.id, mine);
          send(user.id, { type: 'seeking', seek: { baseMs: mine.baseMs, incMs: mine.incMs, color: mine.color, label: mine.label } });
          return;
        }
        seeks.delete(waiting.userId);
        startGame(waiting, mine, now);
        return;
      }
      if (msg.type === 'cancel') {
        if (seeks.delete(user.id)) {
          send(user.id, { type: 'cancelled' });
          return;
        }
        const row = gameFor(user.id);
        if (row && row.ply === 0) {
          abort(row, now);
          return;
        }
        if (row) fail(user.id, 'Resign to leave a game that has started.');
        else send(user.id, { type: 'cancelled' });
        return;
      }
      const row = gameFor(user.id);
      if (!row || (msg.gameId && msg.gameId !== row.id)) {
        fail(user.id, 'That game is not the one you are playing.');
        return;
      }
      const side = sideOf(row, user.id);
      if (msg.type === 'move') {
        if (row.turn !== side) {
          fail(user.id, 'It is not your turn.');
          return;
        }
        const elapsed = Math.max(0, now - row.turnStartedAt);
        const clock = clockAfterMove({ wMs: row.wMs, bMs: row.bMs, incMs: row.incMs, turn: side, elapsedMs: elapsed });
        if (clock.flagged) {
          flag(row, now);
          return;
        }
        const applied = applyUci(JSON.parse(row.gameJson), msg.uci);
        if (!applied.ok) {
          fail(user.id, applied.error);
          return;
        }
        if (!Array.isArray(row.moveTimes)) row.moveTimes = [];
        row.moveTimes.push(row.turnStartedAt == null ? null : elapsed);
        row.wMs = clock.wMs;
        row.bMs = clock.bMs;
        row.gameJson = JSON.stringify(applied.game);
        row.drawOffer = null;
        row.updatedAt = now;
        row.ply = applied.game.uci.length;
        if (applied.result) {
          const game = parseGame(applied.game);
          finish(row, game, now);
          return;
        }
        row.turn = side === 'w' ? 'b' : 'w';
        row.turnStartedAt = now;
        save(row);
        broadcast(row, now);
        return;
      }
      if (msg.type === 'resign') {
        stopClock(row, now);
        const game = parseGame(row.gameJson);
        game.resign(side);
        finish(row, game, now);
        return;
      }
      if (msg.type === 'draw') {
        if (row.drawOffer && row.drawOffer !== side) {
          stopClock(row, now);
          const game = parseGame(row.gameJson);
          game.drawByAgreement();
          finish(row, game, now);
          return;
        }
        row.drawOffer = side;
        row.updatedAt = now;
        save(row);
        broadcast(row, now);
        return;
      }
      if (msg.type === 'decline') {
        if (row.drawOffer && row.drawOffer !== side) {
          row.drawOffer = null;
          row.updatedAt = now;
          save(row);
          broadcast(row, now);
        }
        return;
      }
      if (msg.type === 'chat-request' || msg.type === 'chat-accept' || msg.type === 'chat-decline' || msg.type === 'chat') {
        handleChat(row, user.id, msg, now);
        return;
      }
      fail(user.id, 'That action is not recognised.');
    },

    tick(now = Date.now()) {
      for (const row of [...games.values()]) {
        if (row.status !== 'live') continue;
        if (row.turnStartedAt != null) {
          const remaining = row.turn === 'w' ? row.wMs : row.bMs;
          if (now - row.turnStartedAt >= remaining) {
            flag(row, now);
            continue;
          }
        }
        for (const userId of [row.whiteId, row.blackId]) {
          const leftAt = disconnectedAt.get(userId);
          if (leftAt == null || sockets.has(userId)) continue;
          const other = opponentId(row, userId);
          if (!sockets.has(other)) continue;
          const grace = row.ply === 0 ? ABORT_GRACE_MS : FORFEIT_GRACE_MS;
          if (now - leftAt < grace) continue;
          if (row.ply === 0) abort(row, now);
          else {
            stopClock(row, now);
            const game = parseGame(row.gameJson);
            game.resign(sideOf(row, userId));
            const json = game.toJSON();
            if (json.resultInfo) json.resultInfo.reason = 'disconnect';
            row.gameJson = JSON.stringify(json);
            finish(row, parseGame(json), now);
          }
          break;
        }
      }
    },
  };
}
