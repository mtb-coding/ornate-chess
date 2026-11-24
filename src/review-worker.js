/**
 * Module Web Worker that walks a game and asks the page to evaluate each
 * position with Stockfish. Classification itself is cheap; the engine work
 * already runs in the Stockfish worker started by the page.
 *
 * Messages in:  { type:'start', id, startFen, uci, mode, playerColor, depth, name, gameId }
 *               { type:'cancel' }
 *               { type:'analysis', requestId, lines } or { requestId, error }
 * Messages out: { type:'analyse', requestId, fen, depth, multipv }
 *               { type:'progress', done, total, ply }
 *               { type:'result', review }
 *               { type:'error', message }
 *               { type:'cancelled' }
 */
import { START_FEN } from './engine.js';
import { buildReview, replayGame, analyseGame, REVIEW_DEPTH } from './review.js';

let cancelled = false;
let nextRequest = 1;
const pending = new Map();
let running = false;

const engine = {
  analyse(fen, { depth, multipv }) {
    return new Promise((resolve, reject) => {
      if (cancelled) { reject(new Error('cancelled')); return; }
      const requestId = nextRequest++;
      pending.set(requestId, { resolve, reject });
      self.postMessage({ type: 'analyse', requestId, fen, depth, multipv });
    });
  },
};

function failPending(err) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

async function run(msg) {
  if (running) return;
  running = true;
  cancelled = false;
  const depth = msg.depth || REVIEW_DEPTH;
  try {
    const replayed = replayGame(msg.startFen || START_FEN, msg.uci || []);
    const total = replayed.positions.length;
    self.postMessage({ type: 'progress', done: 0, total, ply: 0 });
    const evals = await analyseGame(engine, replayed, {
      depth,
      isCancelled: () => cancelled,
      onProgress: (done, all, ply) => self.postMessage({ type: 'progress', done, total: all, ply }),
    });
    if (cancelled) { self.postMessage({ type: 'cancelled' }); return; }
    const review = buildReview({
      startFen: replayed.startFen,
      uci: replayed.uci,
      sans: replayed.sans,
      mode: msg.mode || 'local',
      playerColor: msg.playerColor,
      depth,
      name: msg.name || '',
      gameId: msg.gameId || null,
      evals,
    });
    review.analyzedAt = Date.now();
    self.postMessage({ type: 'result', review });
  } catch (err) {
    if (cancelled || (err && err.message === 'cancelled')) {
      self.postMessage({ type: 'cancelled' });
    } else {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  } finally {
    running = false;
  }
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'start') {
    cancelled = false;
    run(msg);
  } else if (msg.type === 'cancel') {
    cancelled = true;
    failPending(new Error('cancelled'));
  } else if (msg.type === 'analysis') {
    const p = pending.get(msg.requestId);
    if (!p) return;
    pending.delete(msg.requestId);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.lines || []);
  }
};
