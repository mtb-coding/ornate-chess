// Background puzzle generation for the generated-puzzle mode.
// A small pool of module workers plays games and finds candidate puzzles. Each
// worker has its own Stockfish engine (see stockfish-client.js) that checks the
// candidates, and this file passes the analysis requests between the two.
// Accepted puzzles are queued per difficulty, and a few are kept in
// localStorage so that the next visit can start at once.
import { Position } from '../engine.js';
import { StockfishEngine } from './stockfish-client.js';

const POOL_KEY = 'ornate-chess:gen-pool-v2';
const OLD_POOL_KEYS = ['ornate-chess:gen-pool'];  // earlier puzzles were not checked by an engine
const STATS_KEY = 'ornate-chess:gen-stats';
const LEVELS = ['easy', 'medium', 'hard'];
const TARGET = 3;                // puzzles to keep ready for the selected level
const MAX_KEEP = 6;              // puzzles stored per level
const TAKE_TIMEOUT_MS = 300000;  // longest wait for a puzzle before giving up
const MAX_WORKER_ERRORS = 3;     // failures in a row before generation is declared broken

function readJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; }
}
function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } }

// ---- Statistics ---------------------------------------------------------------
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 1e9) : 0);
const cleanLevel = (x) => ({ solved: count(x && x.solved), attempted: count(x && x.attempted) });
const EMPTY_STATS = () => ({ solved: 0, attempted: 0, streak: 0, best: 0, byLevel: { easy: cleanLevel(), medium: cleanLevel(), hard: cleanLevel() } });
/** Stored values of the wrong type are replaced by zero, so that damaged storage never reaches the display. */
export function readStats() {
  const s = readJson(STATS_KEY, null);
  const out = EMPTY_STATS();
  if (!s || Array.isArray(s)) return out;
  out.solved = count(s.solved); out.attempted = count(s.attempted); out.streak = count(s.streak);
  out.best = Math.max(count(s.best), out.streak);
  const by = s.byLevel && typeof s.byLevel === 'object' ? s.byLevel : {};
  for (const l of LEVELS) out.byLevel[l] = cleanLevel(by[l]);
  return out;
}
/** solved: the player finished the line; clean: also without a wrong move, hint or revealed solution. */
export function recordResult(level, clean, solved = clean) {
  const s = readStats();
  s.attempted += 1;
  const lv = s.byLevel[level] || (s.byLevel[level] = { solved: 0, attempted: 0 });
  lv.attempted += 1;
  if (solved) { s.solved += 1; lv.solved += 1; }
  if (clean) { s.streak += 1; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
  writeJson(STATS_KEY, s);
  return s;
}

// ---- Puzzle validation ----------------------------------------------------------
/** True when `p` is a well-formed puzzle: a legal position and a legal solution that ends with the solver's move. */
export function validPuzzle(p) {
  try {
    if (!p || typeof p !== 'object' || typeof p.fen !== 'string' || !LEVELS.includes(p.level)) return false;
    if (typeof p.code !== 'string' || !/^[emh][0-9a-z]+\.[0-9a-z]+$/.test(p.code)) return false;
    if (!Array.isArray(p.solution) || !p.solution.length || p.solution.length % 2 === 0 || p.solution.length > 12) return false;
    let pos = Position.fromFen(p.fen);
    for (const u of p.solution) {
      if (typeof u !== 'string') return false;
      const m = pos.parseUci(u);
      if (!m) return false;
      pos = pos.makeMove(m);
    }
    return typeof p.title === 'string' && typeof p.explanation === 'string' && Number.isFinite(p.rating);
  } catch { return false; }
}

// ---- Generator ----------------------------------------------------------------
class GeneratorPool {
  constructor() {
    for (const k of OLD_POOL_KEYS) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
    const saved = readJson(POOL_KEY, {});
    this.pool = Object.fromEntries(LEVELS.map((l) => [l, Array.isArray(saved[l]) ? saved[l].filter((p) => p && p.level === l && validPuzzle(p)) : []]));
    this.workers = [];   // { w, sf }
    this.level = 'medium';
    this.waiters = [];
    this.listeners = new Set();
    this.running = false;
    this.fallback = false;
    this.broken = '';
    this.errorsInRow = 0;
    this.seen = new Set();
    this.stats = { found: 0, startedAt: 0 };
  }
  persist() { writeJson(POOL_KEY, Object.fromEntries(LEVELS.map((l) => [l, this.pool[l].slice(0, MAX_KEEP)]))); }
  emit() { this.listeners.forEach((f) => { try { f(this.status()); } catch { /* listener errors are ignored */ } }); }
  onStatus(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  status() { return { level: this.level, ready: this.pool[this.level].length, running: this.running, waiting: this.waiters.length > 0, broken: this.broken }; }
  /** Discard a pooled puzzle that turned out to be unusable. */
  discard(p) {
    for (const l of LEVELS) this.pool[l] = this.pool[l].filter((x) => x !== p && x.code !== p.code);
    this.persist();
  }

  workerCount() {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    const memory = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
    return Math.max(1, Math.min(memory <= 2 ? 1 : 3, cores - 1));
  }
  ensureWorkers() {
    if (this.workers.length || this.fallback || this.broken) return;
    try {
      for (let i = 0; i < this.workerCount(); i++) {
        const w = new Worker(new URL('../puzzle-gen-worker.js', import.meta.url), { type: 'module' });
        const entry = { w, sf: new StockfishEngine() };
        w.onmessage = (ev) => this.onMessage(ev.data || {}, entry);
        w.onerror = (err) => { console.warn('[puzzle generator]', err.message || err); this.useFallback(); };
        this.workers.push(entry);
      }
    } catch (err) { console.warn('[puzzle generator] Workers are unavailable.', err); this.useFallback(); }
  }
  /** Main-thread generation, used when module workers are not available. */
  useFallback() {
    this.workers.forEach((e) => { e.w.terminate(); e.sf.terminate(); });
    this.workers = [];
    this.fallback = true;
    if (this.running) this.runFallback();
  }
  async runFallback() {
    if (this.fbActive) return;
    this.fbActive = true;
    let gen = null;
    try { gen = await import('../puzzle-gen.js'); } catch (err) { this.onMessage({ type: 'error', error: String((err && err.message) || err) }); }
    let seed = gen ? gen.randomSeed() : 0;
    let failures = 0;
    while (gen && this.running) {
      // One game per task keeps the page responsive between games.
      await new Promise((r) => setTimeout(r, 30 + failures * 500));
      try {
        this.fbEngine = this.fbEngine || new StockfishEngine();
        seed = (seed * 1103515245 + 12345) >>> 0;
        const list = await gen.scanGameVerified(seed, this.level, this.fbEngine, { onlyLevel: this.level, shouldStop: () => !this.running });
        failures = 0;
        list.forEach((p) => this.onMessage({ type: 'puzzle', puzzle: p }));
      } catch (err) {
        failures++;
        this.onMessage({ type: 'error', error: String((err && err.message) || err) });
      }
    }
    this.fbActive = false;
  }
  onMessage(msg, entry) {
    if (msg.type === 'analyse' && entry) {
      entry.sf.analyse(msg.fen, { depth: msg.depth, multipv: msg.multipv }).then(
        (lines) => entry.w.postMessage({ type: 'analysis', id: msg.id, lines }),
        (err) => entry.w.postMessage({ type: 'analysis', id: msg.id, error: String((err && err.message) || err) }),
      );
    } else if (msg.type === 'error') {
      console.warn('[puzzle generator]', msg.error);
      if (++this.errorsInRow >= MAX_WORKER_ERRORS) this.fail(msg.error || 'The generator failed.');
    } else if (msg.type === 'puzzle' && msg.puzzle) {
      const p = msg.puzzle;
      this.errorsInRow = 0;
      if (this.seen.has(p.code) || !validPuzzle(p)) return;
      this.seen.add(p.code);
      this.stats.found++;
      const waiter = this.waiters.find((w) => w.level === p.level);
      if (waiter) { this.waiters.splice(this.waiters.indexOf(waiter), 1); waiter.resolve(p); } else if (this.pool[p.level].length < MAX_KEEP) { this.pool[p.level].push(p); this.persist(); }
      this.balance();
      this.emit();
    }
  }
  /** Generation keeps failing: stop it and tell everyone who is waiting. */
  fail(reason) {
    this.broken = reason;
    const waiting = this.waiters;
    this.stop();
    waiting.forEach((w) => w.reject(new Error(reason)));
    this.emit();
  }
  /** Allow generation again after a failure, for example when the player selects Next puzzle. */
  retry() { this.broken = ''; this.errorsInRow = 0; }
  /** Run while the selected level is short of puzzles or someone is waiting. */
  balance() {
    const need = !this.broken && (this.waiters.length > 0 || this.pool[this.level].length < TARGET);
    if (need && !this.running) {
      this.running = true;
      this.stats.startedAt = Date.now();
      this.ensureWorkers();
      if (this.fallback) this.runFallback();
      else this.workers.forEach((e) => e.w.postMessage({ type: 'run', level: this.level, seed: (Math.random() * 4294967296) >>> 0 }));
    } else if (!need && this.running) {
      this.running = false;
      this.workers.forEach((e) => e.w.postMessage({ type: 'pause' }));
    }
    this.emit();
  }
  setLevel(level) {
    if (!LEVELS.includes(level) || level === this.level) return;
    this.level = level;
    if (this.running) this.workers.forEach((e) => e.w.postMessage({ type: 'run', level }));
    this.balance();
  }
  /**
   * Resolves with the next puzzle of `level`, from the queue or when one is
   * found. Rejects when generation fails or takes longer than TAKE_TIMEOUT_MS.
   */
  take(level) {
    this.setLevel(level);
    const p = this.pool[level].shift();
    if (p) { this.persist(); this.balance(); return Promise.resolve(p); }
    if (this.broken) return Promise.reject(new Error(this.broken));
    return new Promise((resolve, reject) => {
      const waiter = { level, resolve: (v) => { clearTimeout(waiter.timer); resolve(v); }, reject: (e) => { clearTimeout(waiter.timer); reject(e); } };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        this.balance();
        reject(new Error('No puzzle was found in time.'));
      }, TAKE_TIMEOUT_MS);
      this.waiters.push(waiter);
      this.balance();
    });
  }
  cancelWaiting() {
    this.waiters.forEach((w) => clearTimeout(w.timer));
    this.waiters = [];
    this.balance();
  }
  /**
   * Rebuild a puzzle from its code, then check it with the engine. Resolves
   * with the puzzle (verified true or false) or with null if the code is invalid.
   * A failed or unavailable engine check still returns the puzzle, labelled as
   * unverified, so that the uniqueness claim is not shown.
   */
  fromCode(code) {
    return this.rebuildCode(code).then(async (raw) => {
      if (!raw) return null;
      const { verifyRebuiltPuzzle } = await import('../puzzle-gen.js');
      const sf = new StockfishEngine();
      try { return await verifyRebuiltPuzzle(raw, sf); }
      catch { return verifyRebuiltPuzzle(raw, null); }
      finally { sf.terminate(); }
    });
  }
  /** Rebuild only, without the engine check. */
  rebuildCode(code) {
    return new Promise((resolve) => {
      let w;
      const timer = setTimeout(() => done(null), 60000);
      const done = (p) => { clearTimeout(timer); if (w) w.terminate(); resolve(p); };
      try {
        w = new Worker(new URL('../puzzle-gen-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = (ev) => { if (ev.data && ev.data.type === 'code') done(ev.data.puzzle); };
        w.onerror = () => done(null);
        w.postMessage({ type: 'code', id: 1, code });
      } catch {
        clearTimeout(timer);
        import('../puzzle-gen.js').then((g) => resolve(g.puzzleFromCode(code))).catch(() => resolve(null));
      }
    });
  }
  /** Stop all background work, including the engines. Called when the page is left. */
  stop() {
    this.running = false;
    this.waiters.forEach((w) => clearTimeout(w.timer));
    this.waiters = [];
    this.workers.forEach((e) => { e.w.terminate(); e.sf.terminate(); });
    this.workers = [];
    if (this.fbEngine) { this.fbEngine.terminate(); this.fbEngine = null; }
    this.emit();
  }
}

let instance = null;
export function generator() { return instance || (instance = new GeneratorPool()); }
