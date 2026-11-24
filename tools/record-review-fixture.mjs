// Records real engine output for the review fixtures used by
// tests/review.test.mjs and tests/gui-review.mjs, so that those tests (and the
// screenshots they take) show what Stockfish actually says about the moves.
// The evaluations come from the same pipeline as the page (analyseGame with
// the bundled Stockfish 19 lite build at REVIEW_DEPTH, MultiPV 2).
// Run: node tools/record-review-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_FEN } from '../src/engine.js';
import { replayGame, analyseGame, REVIEW_DEPTH } from '../src/review.js';
import { createNodeEngine } from '../tests/node-stockfish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/fixtures/italian-review-evals.json');
const PREFIX = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 d2d3 g8f6 b1c3 d7d6 c1g5 h7h6 g5h4 g7g5'.split(' ');
const GAMES = {
  // The game from the user's report: 7...g5 is sound and 8.Nxg5 is a mistake
  // or an inaccuracy (lichess cloud eval at depth 48: 7...g5 -0.27,
  // 8.Bg3 -0.20, 8.Nxg5 -1.02).
  g5: [...PREFIX, 'f3g5'],
  // A real error sequence for the GUI fixture: 8.O-O?? leaves the h4 bishop
  // to 8...gxh4, Black misses it with 8...h5?, and 9.Nxg5 wins the g5 pawn
  // with a large advantage.
  castleMiss: [...PREFIX, 'e1g1', 'h6h5', 'f3g5'],
};

const engine = createNodeEngine();
const out = { engine: 'stockfish-19-lite-single (bundled)', depth: REVIEW_DEPTH, multipv: 2, generatedAt: new Date().toISOString().slice(0, 10), games: {} };
try {
  for (const [name, uci] of Object.entries(GAMES)) {
    const replayed = replayGame(START_FEN, uci);
    const evals = await analyseGame(engine, replayed, { depth: REVIEW_DEPTH });
    out.games[name] = {
      startFen: START_FEN,
      uci,
      evals: evals.map((e) => ({ turn: e.turn, lines: e.lines.map((l) => ({ move: l.move, kind: l.kind, value: l.value, pv: (l.pv || [l.move]).slice(0, 12) })) })),
    };
    console.log(`${name}: ${evals.length} positions`);
  }
} finally {
  engine.quit();
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log('Wrote', path.relative(ROOT, OUT));
