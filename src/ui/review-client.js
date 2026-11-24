// Starts, tracks and cancels a post-game review. Engine analysis is done
// with the existing StockfishEngine wrapper; the walk and classification
// run in review-worker.js so the page stays responsive.
import { StockfishEngine } from './stockfish-client.js';
import { reviewStore } from '../review-storage.js';
import { REVIEW_DEPTH, reviewFingerprint } from '../review.js';

const WORKER_URL = new URL('../review-worker.js', import.meta.url);

let worker = null;
let engine = null;
let current = null; // { fingerprint, onProgress, onDone, onError }

function ensureEngine() {
  if (!engine) engine = new StockfishEngine();
  return engine;
}

function stopWorker() {
  if (worker) {
    try { worker.postMessage({ type: 'cancel' }); } catch { /* ignore */ }
    try { worker.terminate(); } catch { /* ignore */ }
    worker = null;
  }
}

function dropEngine() {
  if (engine) { try { engine.terminate(); } catch { /* ignore */ } engine = null; }
}

export function isReviewing() {
  return !!current;
}

export function cachedReview(record, depth = REVIEW_DEPTH) {
  if (!record || !record.game) return null;
  const startFen = record.game.startFen;
  const uci = record.game.uci || [];
  try { return reviewStore().loadReview(startFen, uci, depth); } catch { return null; }
}

export function reviewKey(record, depth = REVIEW_DEPTH) {
  if (!record || !record.game) return '';
  return reviewFingerprint(record.game.startFen, record.game.uci || [], depth);
}

export function cancelReview() {
  const job = current;
  current = null;
  stopWorker();
  dropEngine();
  if (job && job.onError) { /* cancelled is not an error for the page */ }
  return job;
}

export function startReview(record, { depth = REVIEW_DEPTH, onProgress, onDone, onError } = {}) {
  if (!record || !record.game) {
    const err = new Error('There is no game to review.');
    if (onError) onError(err);
    return Promise.reject(err);
  }
  const cached = cachedReview(record, depth);
  if (cached) {
    if (onDone) onDone(cached, { cached: true });
    return Promise.resolve(cached);
  }
  cancelReview();
  const fingerprint = reviewKey(record, depth);
  const job = { fingerprint, onProgress, onDone, onError, depth };
  current = job;
  const sf = ensureEngine();
  worker = new Worker(WORKER_URL, { type: 'module' });

  const done = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
    worker.onerror = (ev) => {
      const err = new Error(ev && ev.message ? ev.message : 'The review worker failed.');
      finish(err, null);
    };
    worker.onmessage = async (ev) => {
      const msg = ev.data || {};
      if (current !== job) return;
      if (msg.type === 'progress') {
        if (onProgress) onProgress(msg);
      } else if (msg.type === 'analyse') {
        try {
          const lines = await sf.analyse(msg.fen, { depth: msg.depth, multipv: msg.multipv });
          if (current !== job || !worker) return;
          worker.postMessage({ type: 'analysis', requestId: msg.requestId, lines });
        } catch (err) {
          if (current !== job || !worker) return;
          worker.postMessage({ type: 'analysis', requestId: msg.requestId, error: err.message || String(err) });
        }
      } else if (msg.type === 'result') {
        finish(null, msg.review);
      } else if (msg.type === 'cancelled') {
        finish(new Error('cancelled'), null);
      } else if (msg.type === 'error') {
        finish(new Error(msg.message || 'The review failed.'), null);
      }
    };
  });

  function finish(err, review) {
    if (current !== job) return;
    current = null;
    stopWorker();
    dropEngine();
    if (err) {
      if (err.message !== 'cancelled' && onError) onError(err);
      job.reject(err);
      return;
    }
    try { reviewStore().saveReview(review); } catch { /* storage may be blocked */ }
    if (onDone) onDone(review, { cached: false });
    job.resolve(review);
  }

  worker.postMessage({
    type: 'start',
    startFen: record.game.startFen,
    uci: record.game.uci || [],
    mode: record.mode || 'local',
    playerColor: record.playerColor,
    depth,
    name: record.name || '',
    gameId: record.id || null,
  });
  return done;
}

export { REVIEW_DEPTH };
