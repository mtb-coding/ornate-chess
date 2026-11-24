// Records real engine output for an 80-ply (40-move) game, used by
// tests/gui-review-perf.mjs to measure stepping latency on a realistic review.
// Run: node tools/record-perf-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_FEN } from '../src/engine.js';
import { replayGame, analyseGame, REVIEW_DEPTH } from '../src/review.js';
import { createNodeEngine } from '../tests/node-stockfish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/fixtures/perf-review-evals.json');
// The same bot-played game that tools/time-review.mjs times.
const UCI = `
b2b3 e7e5 c1b2 b8c6 e2e3 g8f6 g1f3 e5e4 f3e5 c6e5 b2e5 f6d5 b1c3 d8g5 e5d4 d5c3
d4c3 f8d6 d1e2 e8g8 e2b5 g5g4 b5d5 g8h8 c3d4 g4g6 d5a5 g6h6 g2g3 a7a6 a5f5 h6e6
f5e6 d7e6 f1c4 e6e5 d4c3 c8g4 h1g1 a8a7 a1b1 h8g8 b1b2 f8d8 g1g2 g4f3 g2g1 d6e7
c3e5 e7b4 e5d4 c7c5 a2a3 b4a3 b2a2 a3b4 c2c3 c5d4 c3b4 d4e3 f2e3 d8d6 g1f1 a7a8
f1f2 a8c8 d2d4 d6b6 a2a4 g8f8 e1d2 c8c7 d2c3 b6d6 f2a2 c7c6 a2d2 b7b5 a4a1 b5c4
`.trim().split(/\s+/);
const engine = createNodeEngine();
try {
  const replayed = replayGame(START_FEN, UCI);
  const evals = await analyseGame(engine, replayed, { depth: REVIEW_DEPTH });
  const out = { engine: 'stockfish-19-lite-single (bundled)', depth: REVIEW_DEPTH, multipv: 2, generatedAt: new Date().toISOString().slice(0, 10),
    startFen: START_FEN, uci: UCI,
    evals: evals.map((e) => ({ turn: e.turn, lines: e.lines.map((l) => ({ move: l.move, kind: l.kind, value: l.value, pv: (l.pv || [l.move]).slice(0, 12) })) })) };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log('Wrote', path.relative(ROOT, OUT), evals.length, 'positions');
} finally { engine.quit(); }
