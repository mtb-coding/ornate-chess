/**
 * Module Web Worker that generates puzzles in the background. The chess
 * engine that checks candidates lives on the page side, so every analysis is
 * requested with a message and answered by the page.
 * Messages in:  {type:'run', level, seed?}      start or retarget generation
 *               {type:'pause'}                  stop after the current candidate
 *               {type:'code', id, code}         rebuild a puzzle from its code
 *               {type:'analysis', id, lines}    answer to an analysis request
 *                                               (or {id, error} when it failed)
 * Messages out: {type:'puzzle', puzzle}         every verified puzzle found
 *               {type:'analyse', id, fen, depth, multipv}  engine request
 *               {type:'error', error}           a failure, followed by a pause before the next attempt
 *               {type:'idle'}                   generation paused
 *               {type:'code', id, puzzle}       answer to a code request
 */
import { scanGameVerified, puzzleFromCode, randomSeed } from './puzzle-gen.js';

let level = 'medium';
let running = false;
let seed = randomSeed();
let game = 0;
let loopActive = false;
let runId = 0;
let errors = 0;
let nextRequest = 1;
const pending = new Map();

const engine = {
  analyse(fen, { depth, multipv }) {
    return new Promise((resolve, reject) => {
      const id = nextRequest++;
      pending.set(id, { resolve, reject });
      self.postMessage({ type: 'analyse', id, fen, depth, multipv });
    });
  },
};

function mix(s, i) {
  let h = (s ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

async function loop() {
  if (loopActive) return;
  loopActive = true;
  while (running) {
    const mine = runId;
    const gameSeed = mix(seed, game++);
    try {
      await scanGameVerified(gameSeed, level, engine, {
        onlyLevel: level,
        shouldStop: () => !running || mine !== runId,
        onPuzzle: (p) => { errors = 0; self.postMessage({ type: 'puzzle', puzzle: p }); },
      });
    } catch (err) {
      errors++;
      self.postMessage({ type: 'error', error: String((err && err.message) || err) });
      // Wait longer after each failure in a row, so that a systematic fault does not spin.
      await new Promise((r) => setTimeout(r, Math.min(10000, 500 * errors * errors)));
    }
    // Yield so that pause and retarget messages are processed between games.
    await new Promise((r) => setTimeout(r, 0));
  }
  loopActive = false;
  self.postMessage({ type: 'idle' });
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'run') {
    if (msg.level && msg.level !== level) { level = msg.level; runId++; }
    if (msg.seed != null) { seed = msg.seed >>> 0; game = 0; }
    running = true;
    loop();
  } else if (msg.type === 'pause') {
    running = false;
  } else if (msg.type === 'analysis') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.lines || []);
  } else if (msg.type === 'code') {
    let puzzle = null;
    try { puzzle = puzzleFromCode(msg.code); } catch { puzzle = null; }
    self.postMessage({ type: 'code', id: msg.id, puzzle });
  }
};
