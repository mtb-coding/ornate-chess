/**
 * Module Web Worker for the chess AI.
 * Protocol: receives {id, type:'choose'|'analyze'|'abort', fen, historyFens, options}
 * posts {id, ok, result} with moves as UCI strings; or {id, ok:false, error}.
 */

import { Position } from './engine.js';
import { chooseMove, analyze, DIFFICULTIES } from './ai.js';

const controllers = new Map();

function moveToUciSafe(pos, move) {
  if (!move) return null;
  if (typeof pos.moveToUci === 'function') return pos.moveToUci(move);
  const promo = move.promotion ? move.promotion : '';
  const file = (sq) => 'abcdefgh'[sq & 7];
  const rank = (sq) => String((sq >> 3) + 1);
  return file(move.from) + rank(move.from) + file(move.to) + rank(move.to) + promo;
}

function serializePv(pos, pv) {
  const out = [];
  let p = pos;
  for (const m of pv || []) {
    out.push(moveToUciSafe(p, m));
    try {
      p = p.makeMove(m);
    } catch {
      break;
    }
  }
  return out;
}

function historyFromFens(fens) {
  if (!Array.isArray(fens)) return [];
  const out = [];
  for (const fen of fens) {
    try {
      out.push(Position.fromFen(fen));
    } catch {
      /* skip bad fen */
    }
  }
  return out;
}

async function handleChoose(msg) {
  const pos = Position.fromFen(msg.fen);
  const history = historyFromFens(msg.historyFens);
  const opts = { ...(msg.options || {}) };
  const ac = new AbortController();
  controllers.set(msg.id, ac);
  opts.signal = ac.signal;
  opts.history = history;

  const result = await chooseMove(pos, opts);
  controllers.delete(msg.id);

  return {
    move: moveToUciSafe(pos, result.move),
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    pv: serializePv(pos, result.pv),
    difficulties: undefined,
  };
}

async function handleAnalyze(msg) {
  const pos = Position.fromFen(msg.fen);
  const opts = { ...(msg.options || {}) };
  const ac = new AbortController();
  controllers.set(msg.id, ac);
  opts.signal = ac.signal;

  const lines = await analyze(pos, opts);
  controllers.delete(msg.id);

  return lines.map((line) => ({
    move: moveToUciSafe(pos, line.move),
    score: line.score,
    pv: serializePv(pos, line.pv),
  }));
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const { id, type } = msg;

  if (type === 'abort') {
    const ac = controllers.get(msg.targetId ?? id);
    if (ac) ac.abort();
    // Also abort all if no target
    if (msg.targetId == null && id == null) {
      for (const c of controllers.values()) c.abort();
    }
    return;
  }

  if (type === 'difficulties') {
    self.postMessage({ id, ok: true, result: DIFFICULTIES });
    return;
  }

  try {
    let result;
    if (type === 'choose') result = await handleChoose(msg);
    else if (type === 'analyze') result = await handleAnalyze(msg);
    else throw new Error(`Unknown message type: ${type}`);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    controllers.delete(id);
    self.postMessage({
      id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};
