/**
 * Guarded localStorage for cached game reviews and personal mistake puzzles.
 * Accepts an injectable backend (default: localStorage with an in-memory
 * fallback) so Node tests can run without a browser.
 */
import { MemoryStorage, STORAGE_PREFIX } from './storage.js';
import { reviewFingerprint, SCHEME_VERSION, SCHEME_ID, REVIEW_DEPTH } from './review.js';

export const MAX_REVIEWS = 30;
export const MAX_MISTAKES = 200;

const KEYS = {
  index: `${STORAGE_PREFIX}reviews-index`,
  review: (fp) => `${STORAGE_PREFIX}review:${fp}`,
  mistakes: `${STORAGE_PREFIX}mistake-puzzles`,
};

function resolveBackend(backend) {
  if (backend) return backend;
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
      const probe = `${STORAGE_PREFIX}__review-probe`;
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    /* private mode or blocked */
  }
  return new MemoryStorage();
}

function readJSON(backend, key, fallback) {
  let raw;
  try { raw = backend.getItem(key); } catch { return fallback; }
  if (raw == null || raw === '') return fallback;
  try { return JSON.parse(raw); } catch {
    try { backend.removeItem(key); } catch { /* ignore */ }
    return fallback;
  }
}

function writeJSON(backend, key, value) {
  try {
    backend.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(backend, key) {
  try { backend.removeItem(key); } catch { /* ignore */ }
}

function defaultIndex() {
  return { version: SCHEME_VERSION, order: [] };
}

function defaultMistakes() {
  return { version: 1, puzzles: [] };
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return 'm-' + crypto.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ReviewStore {
  constructor(options = {}) {
    this.backend = resolveBackend(options.backend);
  }

  fingerprint(startFen, uci, depth = REVIEW_DEPTH) {
    return reviewFingerprint(startFen, uci, depth);
  }

  _index() {
    const idx = readJSON(this.backend, KEYS.index, defaultIndex());
    if (!idx || !Array.isArray(idx.order)) return defaultIndex();
    return idx;
  }

  _writeIndex(idx) {
    if (!writeJSON(this.backend, KEYS.index, idx)) {
      this._evict(Math.max(1, Math.floor((idx.order || []).length / 2)));
      writeJSON(this.backend, KEYS.index, idx);
    }
  }

  _evict(count) {
    const idx = this._index();
    const drop = idx.order.splice(0, Math.min(count, idx.order.length));
    for (const fp of drop) removeKey(this.backend, KEYS.review(fp));
    writeJSON(this.backend, KEYS.index, idx);
  }

  loadReview(startFen, uci, depth = REVIEW_DEPTH) {
    const fp = this.fingerprint(startFen, uci, depth);
    const rec = readJSON(this.backend, KEYS.review(fp), null);
    if (!rec || rec.scheme !== SCHEME_ID || rec.version !== SCHEME_VERSION) return null;
    if (rec.depth !== depth) return null;
    return rec;
  }

  saveReview(review) {
    if (!review || !review.uci) return false;
    const fp = this.fingerprint(review.startFen, review.uci, review.depth || REVIEW_DEPTH);
    const stamped = { ...review, analyzedAt: review.analyzedAt || Date.now(), fingerprint: fp };
    const ok = writeJSON(this.backend, KEYS.review(fp), stamped);
    if (!ok) {
      this._evict(5);
      if (!writeJSON(this.backend, KEYS.review(fp), stamped)) return false;
    }
    const idx = this._index();
    idx.order = idx.order.filter((k) => k !== fp);
    idx.order.push(fp);
    while (idx.order.length > MAX_REVIEWS) {
      const old = idx.order.shift();
      if (old) removeKey(this.backend, KEYS.review(old));
    }
    this._writeIndex(idx);
    this.addMistakesFromReview(stamped);
    return true;
  }

  deleteReview(startFen, uci, depth = REVIEW_DEPTH) {
    const fp = this.fingerprint(startFen, uci, depth);
    removeKey(this.backend, KEYS.review(fp));
    const idx = this._index();
    idx.order = idx.order.filter((k) => k !== fp);
    this._writeIndex(idx);
  }

  listReviews() {
    const idx = this._index();
    const out = [];
    for (const fp of (idx.order || [])) {
      const rec = readJSON(this.backend, KEYS.review(fp), null);
      if (!rec || rec.scheme !== SCHEME_ID || rec.version !== SCHEME_VERSION) continue;
      out.push(rec);
    }
    return out;
  }

  listMistakes() {
    const data = readJSON(this.backend, KEYS.mistakes, defaultMistakes());
    const list = Array.isArray(data.puzzles) ? data.puzzles : [];
    return list.filter((p) => p && p.fen && Array.isArray(p.solution) && p.solution[0] && !p.removed);
  }

  _writeMistakes(puzzles) {
    const trimmed = puzzles.slice(-MAX_MISTAKES);
    if (!writeJSON(this.backend, KEYS.mistakes, { version: 1, puzzles: trimmed })) {
      const shorter = trimmed.slice(-Math.max(10, Math.floor(trimmed.length / 2)));
      return writeJSON(this.backend, KEYS.mistakes, { version: 1, puzzles: shorter });
    }
    return true;
  }

  addMistakesFromReview(review) {
    const incoming = (review && review.mistakes) || [];
    if (!incoming.length) return 0;
    const data = readJSON(this.backend, KEYS.mistakes, defaultMistakes());
    const puzzles = Array.isArray(data.puzzles) ? data.puzzles : [];
    const seen = new Set(puzzles.filter((p) => !p.removed).map((p) => `${p.fen}|${p.solution && p.solution[0]}`));
    let added = 0;
    for (const m of incoming) {
      if (!m || !m.fen || !m.solution || !m.solution[0]) continue;
      const key = `${m.fen}|${m.solution[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      puzzles.push({
        id: makeId(),
        fen: m.fen,
        solution: m.solution,
        playedUci: m.playedUci,
        playedSan: m.playedSan || '',
        bestSan: m.bestSan || '',
        judgment: m.judgment,
        ply: m.ply,
        color: m.color,
        gameName: review.name || '',
        gameFingerprint: review.fingerprint || this.fingerprint(review.startFen, review.uci, review.depth),
        createdAt: Date.now(),
        solved: false,
        attempts: 0,
        usedHint: false,
        lastAt: 0,
      });
      added++;
    }
    if (added) this._writeMistakes(puzzles);
    return added;
  }

  getMistake(id) {
    return this.listMistakes().find((p) => p.id === id) || null;
  }

  markMistake(id, { solved, attempts, usedHint } = {}) {
    const data = readJSON(this.backend, KEYS.mistakes, defaultMistakes());
    const puzzles = Array.isArray(data.puzzles) ? data.puzzles : [];
    const p = puzzles.find((x) => x.id === id);
    if (!p) return null;
    if (typeof attempts === 'number') p.attempts = attempts;
    else if (solved || attempts) p.attempts = (p.attempts || 0) + 1;
    if (usedHint) p.usedHint = true;
    if (solved) p.solved = true;
    p.lastAt = Date.now();
    this._writeMistakes(puzzles);
    return p;
  }

  removeMistake(id) {
    const data = readJSON(this.backend, KEYS.mistakes, defaultMistakes());
    const puzzles = Array.isArray(data.puzzles) ? data.puzzles : [];
    const next = puzzles.filter((p) => p.id !== id);
    this._writeMistakes(next);
    return next.length < puzzles.length;
  }
}

let _default = null;
export function reviewStore() {
  if (!_default) _default = new ReviewStore();
  return _default;
}

/** Used by tests to inject a backend. */
export function createReviewStore(options) {
  return new ReviewStore(options);
}
