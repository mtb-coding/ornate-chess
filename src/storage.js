/**
 * Ornate Chess — local persistence (saves, settings, stats, puzzle progress).
 * Injectable backend; defaults to localStorage with an in-memory fallback.
 * Key prefix: ornate-chess:
 */

/** Lazy engine import so settings/saves tests run before engine is ready. */
let _Game = null;
async function loadGameClass() {
  if (_Game) return _Game;
  const mod = await import('./engine.js');
  _Game = mod.Game;
  // Opening names for PGN export (additive; optional if the module is absent).
  try { _openings = await import('./openings.js'); } catch { _openings = null; }
  return _Game;
}
let _openings = null;
function getGameClass() {
  if (_Game) return _Game;
  // Synchronous path used by exportPgn/importPgn/importGameFile after ensureGameLoaded()
  throw new Error('Engine Game class is not loaded. Call ensureGameLoaded() first, or use the async helpers.');
}
export async function ensureGameLoaded() {
  return loadGameClass();
}

/** Attempt to preload Game at import time when engine.js is already present. */
loadGameClass().catch(() => {
  /* engine not ready yet; PGN helpers will throw until ensureGameLoaded() succeeds */
});

import { START_RATING, eloUpdate, isProvisional } from './rating.js';
import { normalizeOnlineRatings } from './online-ratings.js';

export const STORAGE_PREFIX = 'ornate-chess:';
export const SCHEMA_VERSION = 1;
export const MAX_SAVED_GAMES = 50;

const KEYS = {
  games: `${STORAGE_PREFIX}games`,
  autosave: `${STORAGE_PREFIX}autosave`,
  settings: `${STORAGE_PREFIX}settings`,
  stats: `${STORAGE_PREFIX}stats`,
  puzzleProgress: `${STORAGE_PREFIX}puzzle-progress`,
  playerRating: `${STORAGE_PREFIX}player-rating`,
  onlineRatings: `${STORAGE_PREFIX}online-ratings`,
  endgameProgress: `${STORAGE_PREFIX}endgame-progress`,
  schema: `${STORAGE_PREFIX}schema`,
};

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'ebony',
  pieceSet: 'classic',
  boardStyle: 'marble',
  sound: true,
  showLegal: true,
  showCoords: true,
  autoQueen: false,
  animations: true,
  lastBotLevel: 'lvl4',
  hints: true,
});

const DEFAULT_STATS = () => ({
  version: SCHEMA_VERSION,
  byLevel: {},
  totals: { wins: 0, losses: 0, draws: 0, games: 0 },
});

const DEFAULT_PUZZLE_PROGRESS = () => ({
  version: SCHEMA_VERSION,
  rating: 1200,
  puzzles: {}, // id -> { solved, attempts, usedHint, lastAt }
});

const DEFAULT_ENDGAME_PROGRESS = () => ({
  version: SCHEMA_VERSION,
  positions: {}, // id -> { completed, attempts, usedHint, lastAt }
});

const emptyWdl = () => ({ wins: 0, losses: 0, draws: 0, games: 0 });

/** Rating history entries kept for the chart; older entries are dropped. */
export const MAX_RATING_HISTORY = 500;

const DEFAULT_PLAYER_RATING = () => ({
  version: SCHEMA_VERSION,
  rating: START_RATING,
  games: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  peak: START_RATING,
  history: [], // { at, rating, delta, opponent, botLevel, score }
});

/** In-memory Map-backed storage for Node tests and environments without localStorage. */
export class MemoryStorage {
  constructor(initial = {}) {
    this._map = new Map(Object.entries(initial));
  }
  getItem(key) {
    return this._map.has(key) ? this._map.get(key) : null;
  }
  setItem(key, value) {
    this._map.set(key, String(value));
  }
  removeItem(key) {
    this._map.delete(key);
  }
  clear() {
    this._map.clear();
  }
  get length() {
    return this._map.size;
  }
  key(i) {
    return [...this._map.keys()][i] ?? null;
  }
}

function resolveBackend(backend) {
  if (backend) return backend;
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
      // Probe write (Safari private mode can throw)
      const probe = `${STORAGE_PREFIX}__probe`;
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    // fall through
  }
  return new MemoryStorage();
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Storage facade. Pass `{ backend }` to inject a Storage-like object.
 */
export class ChessStorage {
  constructor(options = {}) {
    this.backend = resolveBackend(options.backend);
    this._ensureSchema();
  }

  _readRaw(key) {
    try {
      return this.backend.getItem(key);
    } catch {
      return null;
    }
  }

  _writeRaw(key, value) {
    this.backend.setItem(key, value);
  }

  _removeRaw(key) {
    try {
      this.backend.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /**
   * Parse JSON; on corruption reset only that key and return fallback.
   */
  _readJSON(key, fallback) {
    const raw = this._readRaw(key);
    if (raw == null || raw === '') return typeof fallback === 'function' ? fallback() : fallback;
    try {
      return JSON.parse(raw);
    } catch {
      this._removeRaw(key);
      return typeof fallback === 'function' ? fallback() : fallback;
    }
  }

  _writeJSON(key, value) {
    this._writeRaw(key, JSON.stringify(value));
  }

  _ensureSchema() {
    const schema = this._readJSON(KEYS.schema, null);
    if (!schema || typeof schema.version !== 'number') {
      this._writeJSON(KEYS.schema, { version: SCHEMA_VERSION });
      return;
    }
    if (schema.version < SCHEMA_VERSION) {
      this._migrate(schema.version, SCHEMA_VERSION);
      this._writeJSON(KEYS.schema, { version: SCHEMA_VERSION });
    }
  }

  /**
   * Migration hook for future schema bumps. Currently a no-op beyond version stamp.
   * @param {number} from
   * @param {number} to
   */
  _migrate(from, to) {
    // v0 / missing → v1: ensure containers exist with version fields
    if (from < 1 && to >= 1) {
      const games = this._readJSON(KEYS.games, () => []);
      if (!Array.isArray(games)) this._writeJSON(KEYS.games, []);
      const settings = this._readJSON(KEYS.settings, () => ({ ...DEFAULT_SETTINGS }));
      this._writeJSON(KEYS.settings, { ...DEFAULT_SETTINGS, ...settings });
      const stats = this._readJSON(KEYS.stats, DEFAULT_STATS);
      if (!stats.version) {
        stats.version = 1;
        this._writeJSON(KEYS.stats, stats);
      }
      const prog = this._readJSON(KEYS.puzzleProgress, DEFAULT_PUZZLE_PROGRESS);
      if (!prog.version) {
        prog.version = 1;
        this._writeJSON(KEYS.puzzleProgress, prog);
      }
    }
  }

  // ─── Named saves ───────────────────────────────────────────────

  _readGames() {
    const games = this._readJSON(KEYS.games, () => []);
    return Array.isArray(games) ? games : [];
  }

  _writeGames(games) {
    this._writeJSON(KEYS.games, games);
  }

  /**
   * Validate and normalize a save record. Throws Error with a readable message.
   */
  _validateRecord(record, { requireGame = true } = {}) {
    if (!record || typeof record !== 'object') {
      throw new Error('Save record must be an object.');
    }
    if (typeof record.name !== 'string' || !record.name.trim()) {
      throw new Error('Save record requires a non-empty name.');
    }
    const modes = ['bot', 'local', 'puzzle', 'analysis', 'online'];
    if (!modes.includes(record.mode)) {
      throw new Error(`Save record mode must be one of: ${modes.join(', ')}.`);
    }
    if (requireGame) {
      if (!record.game || typeof record.game !== 'object') {
        throw new Error('Save record requires a game object (Game.toJSON()).');
      }
      if (record.game.version !== 1) {
        throw new Error('Save record game.version must be 1.');
      }
      if (typeof record.game.startFen !== 'string' || !Array.isArray(record.game.uci)) {
        throw new Error('Save record game must include startFen (string) and uci (array).');
      }
    }
    if (record.clock != null) {
      const c = record.clock;
      if (typeof c !== 'object' || typeof c.wMs !== 'number' || typeof c.bMs !== 'number') {
        throw new Error('Save record clock must include numeric wMs and bMs.');
      }
    }
    return true;
  }

  saveGame(record) {
    this._validateRecord(record);
    const games = this._readGames();
    const now = Date.now();
    let id = record.id;
    let idx = id ? games.findIndex((g) => g.id === id) : -1;
    if (!id || idx < 0) {
      id = createId();
      idx = -1;
    }
    const entry = {
      id,
      name: record.name.trim(),
      savedAt: now,
      mode: record.mode,
      botLevel: record.botLevel ?? null,
      playerColor: record.playerColor ?? null,
      game: record.game,
      clock: record.clock ?? null,
    };
    if (idx >= 0) games[idx] = entry;
    else games.unshift(entry);

    // Cap list size: drop oldest (end of array) beyond MAX_SAVED_GAMES
    while (games.length > MAX_SAVED_GAMES) games.pop();

    this._writeGames(games);
    return id;
  }

  listGames() {
    return this._readGames().map((g) => ({
      id: g.id,
      name: g.name,
      savedAt: g.savedAt,
      mode: g.mode,
      botLevel: g.botLevel ?? null,
      playerColor: g.playerColor ?? null,
      hasClock: Boolean(g.clock),
      plyCount: Array.isArray(g.game?.uci) ? g.game.uci.length : 0,
    }));
  }

  loadGame(id) {
    if (typeof id !== 'string' || !id) throw new Error('loadGame requires a non-empty id.');
    const games = this._readGames();
    const found = games.find((g) => g.id === id);
    if (!found) return null;
    return {
      id: found.id,
      name: found.name,
      savedAt: found.savedAt,
      mode: found.mode,
      botLevel: found.botLevel ?? null,
      playerColor: found.playerColor ?? null,
      game: found.game,
      clock: found.clock ?? null,
    };
  }

  deleteGame(id) {
    if (typeof id !== 'string' || !id) throw new Error('deleteGame requires a non-empty id.');
    const games = this._readGames();
    const next = games.filter((g) => g.id !== id);
    if (next.length === games.length) return false;
    this._writeGames(next);
    return true;
  }

  renameGame(id, name) {
    if (typeof id !== 'string' || !id) throw new Error('renameGame requires a non-empty id.');
    if (typeof name !== 'string' || !name.trim()) throw new Error('renameGame requires a non-empty name.');
    const games = this._readGames();
    const idx = games.findIndex((g) => g.id === id);
    if (idx < 0) return false;
    games[idx] = { ...games[idx], name: name.trim(), savedAt: Date.now() };
    this._writeGames(games);
    return true;
  }

  // ─── Autosave ──────────────────────────────────────────────────

  saveAutosave(record) {
    this._validateRecord(record);
    const entry = {
      id: record.id || 'autosave',
      name: record.name?.trim() || 'Autosave',
      savedAt: Date.now(),
      mode: record.mode,
      botLevel: record.botLevel ?? null,
      playerColor: record.playerColor ?? null,
      game: record.game,
      clock: record.clock ?? null,
      rating: record.rating && typeof record.rating === 'object' ? record.rating : null,
    };
    this._writeJSON(KEYS.autosave, entry);
    return entry.id;
  }

  loadAutosave() {
    const raw = this._readJSON(KEYS.autosave, null);
    if (!raw || typeof raw !== 'object' || !raw.game) return null;
    return raw;
  }

  clearAutosave() {
    this._removeRaw(KEYS.autosave);
  }

  // ─── File / PGN import-export ──────────────────────────────────

  exportGameFile(record) {
    this._validateRecord(record);
    const payload = {
      format: 'ornate-chess-save',
      version: SCHEMA_VERSION,
      exportedAt: Date.now(),
      record: {
        id: record.id || undefined,
        name: record.name.trim(),
        savedAt: record.savedAt || Date.now(),
        mode: record.mode,
        botLevel: record.botLevel ?? null,
        playerColor: record.playerColor ?? null,
        game: record.game,
        clock: record.clock ?? null,
      },
    };
    return JSON.stringify(payload, null, 2);
  }

  importGameFile(text) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Import text is empty.');
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`Import file is not valid JSON: ${e.message}`);
    }
    // Accept either wrapped format or a bare record
    let record;
    if (parsed && parsed.format === 'ornate-chess-save' && parsed.record) {
      if (typeof parsed.version === 'number' && parsed.version > SCHEMA_VERSION) {
        throw new Error(
          `Import file schema version ${parsed.version} is newer than this app (${SCHEMA_VERSION}).`
        );
      }
      record = parsed.record;
    } else if (parsed && parsed.game && parsed.mode && parsed.name) {
      record = parsed;
    } else {
      throw new Error(
        'Import file is not a recognized ornate-chess save (expected format "ornate-chess-save" or a save record).'
      );
    }
    this._validateRecord(record);
    // Round-trip through Game to ensure the payload is loadable
    try {
      const Game = getGameClass();
      Game.fromJSON(record.game);
    } catch (e) {
      if (e.message && e.message.includes('not loaded')) {
        // Soft-validate shape only when engine is unavailable
        if (!record.game || record.game.version !== 1 || typeof record.game.startFen !== 'string' || !Array.isArray(record.game.uci)) {
          throw new Error('Import file game data failed shape validation.');
        }
      } else {
        throw new Error(`Import file game data could not be loaded: ${e.message}`);
      }
    }
    return {
      id: record.id,
      name: record.name.trim(),
      savedAt: record.savedAt || Date.now(),
      mode: record.mode,
      botLevel: record.botLevel ?? null,
      playerColor: record.playerColor ?? null,
      game: record.game,
      clock: record.clock ?? null,
    };
  }

  exportPgn(record) {
    this._validateRecord(record);
    const Game = getGameClass();
    const game = Game.fromJSON(record.game);
    const headers = {
      Event: record.mode === 'bot' ? 'Ornate Chess vs Bot' : record.mode === 'online' ? 'Ornate Chess online' : 'Ornate Chess',
      Site: 'Ornate Chess',
      Date: new Date(record.savedAt || Date.now()).toISOString().slice(0, 10).replace(/-/g, '.'),
      Round: '-',
      White: (record.game.headers && record.game.headers.White) || (record.playerColor === 'b' ? (record.botLevel ? `Bot (${record.botLevel})` : 'Black') : 'White'),
      Black: (record.game.headers && record.game.headers.Black) || (record.playerColor === 'b' ? 'White' : (record.botLevel ? `Bot (${record.botLevel})` : 'Black')),
      Result: record.game.resultInfo?.result || '*',
    };
    if (record.name) headers.Event = record.name;
    if (_openings) {
      try { Object.assign(headers, _openings.openingHeaders(_openings.identifyOpeningForGame(game))); } catch { /* opening headers are optional */ }
    }
    return game.toPgn(headers);
  }

  importPgn(text) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('PGN text is empty.');
    }
    const Game = getGameClass();
    let game;
    try {
      game = Game.fromPgn(text);
    } catch (e) {
      throw new Error(`PGN could not be parsed: ${e.message}`);
    }
    if (!game) throw new Error('PGN could not be parsed.');
    // Try to pull Event name from headers if Game exposes them; otherwise default
    let name = 'Imported PGN';
    const eventMatch = text.match(/\[Event\s+"([^"]*)"\]/i);
    if (eventMatch && eventMatch[1] && eventMatch[1] !== '?' && eventMatch[1].trim()) {
      name = eventMatch[1].trim();
    }
    return {
      name,
      savedAt: Date.now(),
      mode: 'analysis',
      botLevel: null,
      playerColor: null,
      game: game.toJSON(),
      clock: null,
    };
  }

  // ─── Settings ──────────────────────────────────────────────────

  getSettings() {
    const stored = this._readJSON(KEYS.settings, () => ({}));
    return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
  }

  setSettings(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('setSettings requires an object patch.');
    const current = this.getSettings();
    const next = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_SETTINGS) next[k] = v;
    }
    this._writeJSON(KEYS.settings, next);
    return next;
  }

  // ─── Stats ─────────────────────────────────────────────────────

  recordResult({ mode, botLevel, playerColor, result, opening } = {}) {
    if (!result || !['1-0', '0-1', '1/2-1/2'].includes(result)) {
      throw new Error('recordResult requires result of "1-0", "0-1", or "1/2-1/2".');
    }
    const stats = this._readJSON(KEYS.stats, DEFAULT_STATS);
    if (!stats.byLevel || typeof stats.byLevel !== 'object') stats.byLevel = {};
    if (!stats.totals) stats.totals = emptyWdl();
    if (!stats.byColor || typeof stats.byColor !== 'object') stats.byColor = { w: emptyWdl(), b: emptyWdl() };
    if (!stats.byOpening || typeof stats.byOpening !== 'object') stats.byOpening = {};

    const levelKey = botLevel || mode || 'unknown';
    if (!stats.byLevel[levelKey]) {
      stats.byLevel[levelKey] = { wins: 0, losses: 0, draws: 0, games: 0 };
    }
    const bucket = stats.byLevel[levelKey];

    let outcome = 'draws';
    if (result === '1/2-1/2') {
      outcome = 'draws';
    } else if (playerColor === 'w') {
      outcome = result === '1-0' ? 'wins' : 'losses';
    } else if (playerColor === 'b') {
      outcome = result === '0-1' ? 'wins' : 'losses';
    } else {
      // No player color: treat 1-0 as win for white side stats only via totals draw-ish; count as draw in player terms
      outcome = 'draws';
    }

    bucket[outcome] += 1;
    bucket.games += 1;
    stats.totals[outcome] += 1;
    stats.totals.games += 1;

    if (playerColor === 'w' || playerColor === 'b') {
      if (!stats.byColor[playerColor] || typeof stats.byColor[playerColor] !== 'object') stats.byColor[playerColor] = emptyWdl();
      const colour = stats.byColor[playerColor];
      colour[outcome] += 1;
      colour.games += 1;
    }
    if (opening && typeof opening === 'object') {
      const name = typeof opening.name === 'string' ? opening.name.trim() : '';
      const eco = typeof opening.eco === 'string' ? opening.eco.trim() : '';
      const key = eco || (name ? `name:${name}` : '');
      if (key) {
        if (!stats.byOpening[key] || typeof stats.byOpening[key] !== 'object') {
          stats.byOpening[key] = { name: name || eco || key, eco, ...emptyWdl() };
        }
        const ob = stats.byOpening[key];
        ob[outcome] += 1;
        ob.games += 1;
        if (name) ob.name = name;
        if (eco) ob.eco = eco;
      }
    }

    stats.version = SCHEMA_VERSION;
    this._writeJSON(KEYS.stats, stats);
    return stats;
  }

  getStats() {
    return this._readJSON(KEYS.stats, DEFAULT_STATS);
  }

  // ─── Online bullet, blitz and rapid ratings ───────────────────

  getOnlineRatings() {
    return normalizeOnlineRatings(this._readJSON(KEYS.onlineRatings, null));
  }

  setOnlineRatings(doc) {
    const next = normalizeOnlineRatings(doc);
    this._writeJSON(KEYS.onlineRatings, next);
    return next;
  }

  // ─── Older on-device bot Elo (no longer updated by the app) ──

  /** Returns a normalized copy of the stored player rating. */
  getPlayerRating() {
    const raw = this._readJSON(KEYS.playerRating, DEFAULT_PLAYER_RATING);
    const d = DEFAULT_PLAYER_RATING();
    const out = { ...d, ...(raw && typeof raw === 'object' ? raw : {}) };
    const nonNeg = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e9) : fb);
    out.games = nonNeg(out.games, d.games);
    out.wins = nonNeg(out.wins, d.wins);
    out.draws = nonNeg(out.draws, d.draws);
    out.losses = nonNeg(out.losses, d.losses);
    out.rating = typeof out.rating === 'number' && Number.isFinite(out.rating) ? Math.max(0, Math.min(4000, out.rating)) : d.rating;
    out.peak = typeof out.peak === 'number' && Number.isFinite(out.peak) ? Math.max(0, Math.min(4000, out.peak)) : d.peak;
    if (!Array.isArray(out.history)) out.history = [];
    out.provisional = isProvisional(out.games);
    return out;
  }

  /**
   * Applies one rated game. info: { botLevel, opponent (bot elo), score (0|0.5|1), at? }.
   * Returns { before, after, delta, k, games, provisional, data }.
   */
  recordRatedGame({ botLevel, opponent, score, at = Date.now() } = {}) {
    if (!Number.isFinite(opponent)) throw new Error('recordRatedGame requires a numeric opponent rating.');
    const data = this.getPlayerRating();
    delete data.provisional;
    const upd = eloUpdate(data.rating, opponent, score, data.games);
    data.rating = upd.after;
    data.games += 1;
    if (score === 1) data.wins += 1; else if (score === 0) data.losses += 1; else data.draws += 1;
    data.peak = Math.max(data.peak, upd.after);
    data.history.push({ at, rating: upd.after, delta: upd.delta, opponent, botLevel: botLevel || null, score });
    while (data.history.length > MAX_RATING_HISTORY) data.history.shift();
    data.version = SCHEMA_VERSION;
    this._writeJSON(KEYS.playerRating, data);
    return { ...upd, games: data.games, provisional: isProvisional(data.games), data: { ...data, provisional: isProvisional(data.games) } };
  }

  resetPlayerRating() {
    this._removeRaw(KEYS.playerRating);
    return this.getPlayerRating();
  }

  // ─── Puzzle progress / rating ──────────────────────────────────

  getPuzzleProgress() {
    return this._readJSON(KEYS.puzzleProgress, DEFAULT_PUZZLE_PROGRESS);
  }

  getRating() {
    const prog = this.getPuzzleProgress();
    return typeof prog.rating === 'number' ? prog.rating : 1200;
  }

  /**
   * Elo-style update. Puzzle rating is the opponent rating.
   * K=24 baseline; reduced when a hint was used on a solve.
   */
  markPuzzle(id, { solved, attempts, usedHint, puzzleRating } = {}) {
    if (typeof id !== 'string' || !id) throw new Error('markPuzzle requires a puzzle id.');
    const prog = this.getPuzzleProgress();
    if (!prog.puzzles || typeof prog.puzzles !== 'object') prog.puzzles = {};
    if (typeof prog.rating !== 'number') prog.rating = 1200;

    const prev = prog.puzzles[id] || { solved: false, attempts: 0, usedHint: false, lastAt: 0 };
    const nextAttempts = typeof attempts === 'number' ? attempts : (prev.attempts || 0) + 1;
    const wasSolved = Boolean(prev.solved);
    const nowSolved = wasSolved || Boolean(solved);

    prog.puzzles[id] = {
      solved: nowSolved,
      attempts: nextAttempts,
      usedHint: Boolean(prev.usedHint || usedHint),
      lastAt: Date.now(),
    };

    // Only adjust rating on a first attempt at an unsolved puzzle (not on re-solves).
    if (!wasSolved) {
      const opp = typeof puzzleRating === 'number' ? puzzleRating : prog.rating;
      const expected = 1 / (1 + 10 ** ((opp - prog.rating) / 400));
      let score;
      let K = 24;
      if (solved) {
        score = 1;
        if (usedHint) K = 12;
        if (nextAttempts > 1) K = Math.max(8, K - 4 * (nextAttempts - 1));
      } else {
        score = 0;
      }
      prog.rating = Math.round(Math.max(400, Math.min(2800, prog.rating + K * (score - expected))));
    }

    prog.version = SCHEMA_VERSION;
    this._writeJSON(KEYS.puzzleProgress, prog);
    return prog;
  }

  // ─── Endgame practice progress ─────────────────────────────────

  getEndgameProgress() {
    const raw = this._readJSON(KEYS.endgameProgress, DEFAULT_ENDGAME_PROGRESS);
    const out = DEFAULT_ENDGAME_PROGRESS();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const src = raw.positions && typeof raw.positions === 'object' && !Array.isArray(raw.positions) ? raw.positions : {};
    for (const [id, st] of Object.entries(src)) {
      if (typeof id !== 'string' || !id || !st || typeof st !== 'object') continue;
      const attempts = typeof st.attempts === 'number' && Number.isFinite(st.attempts) && st.attempts > 0 ? Math.min(Math.floor(st.attempts), 1e9) : 0;
      out.positions[id] = {
        completed: st.completed === true,
        attempts,
        usedHint: st.usedHint === true,
        lastAt: typeof st.lastAt === 'number' && Number.isFinite(st.lastAt) ? st.lastAt : 0,
      };
    }
    return out;
  }

  markEndgame(id, { completed, usedHint } = {}) {
    if (typeof id !== 'string' || !id) throw new Error('markEndgame requires an endgame id.');
    const prog = this.getEndgameProgress();
    const prev = prog.positions[id] || { completed: false, attempts: 0, usedHint: false, lastAt: 0 };
    prog.positions[id] = {
      completed: prev.completed === true || completed === true,
      attempts: (prev.attempts || 0) + 1,
      usedHint: prev.usedHint === true || usedHint === true,
      lastAt: Date.now(),
    };
    prog.version = SCHEMA_VERSION;
    this._writeJSON(KEYS.endgameProgress, prog);
    return prog;
  }
}

/** Default singleton using resolved backend (localStorage or memory). */
let _default = null;
function defaultStore() {
  if (!_default) _default = new ChessStorage();
  return _default;
}

/** Reset the default singleton (for tests). */
export function resetDefaultStorage(options) {
  _default = options ? new ChessStorage(options) : null;
}

// Module-level API matching the contract (uses default singleton)
export function saveGame(record) {
  return defaultStore().saveGame(record);
}
export function listGames() {
  return defaultStore().listGames();
}
export function loadGame(id) {
  return defaultStore().loadGame(id);
}
export function deleteGame(id) {
  return defaultStore().deleteGame(id);
}
export function renameGame(id, name) {
  return defaultStore().renameGame(id, name);
}
export function saveAutosave(record) {
  return defaultStore().saveAutosave(record);
}
export function loadAutosave() {
  return defaultStore().loadAutosave();
}
export function clearAutosave() {
  return defaultStore().clearAutosave();
}
export function exportGameFile(record) {
  return defaultStore().exportGameFile(record);
}
export function importGameFile(text) {
  return defaultStore().importGameFile(text);
}
export function exportPgn(record) {
  return defaultStore().exportPgn(record);
}
export function importPgn(text) {
  return defaultStore().importPgn(text);
}
export function getSettings() {
  return defaultStore().getSettings();
}
export function setSettings(patch) {
  return defaultStore().setSettings(patch);
}
export function recordResult(info) {
  return defaultStore().recordResult(info);
}
export function getStats() {
  return defaultStore().getStats();
}
export function getPuzzleProgress() {
  return defaultStore().getPuzzleProgress();
}
export function markPuzzle(id, info) {
  return defaultStore().markPuzzle(id, info);
}
export function getPlayerRating() {
  return defaultStore().getPlayerRating();
}
export function getOnlineRatings() {
  return defaultStore().getOnlineRatings();
}
export function setOnlineRatings(doc) {
  return defaultStore().setOnlineRatings(doc);
}
export function recordRatedGame(info) {
  return defaultStore().recordRatedGame(info);
}
export function resetPlayerRating() {
  return defaultStore().resetPlayerRating();
}
export function getRating() {
  return defaultStore().getRating();
}
export function getEndgameProgress() {
  return defaultStore().getEndgameProgress();
}
export function markEndgame(id, info) {
  return defaultStore().markEndgame(id, info);
}

/**
 * Create an isolated storage instance (preferred in tests).
 */
export function createStorage(options) {
  return new ChessStorage(options);
}
