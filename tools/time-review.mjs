// Time a post-game review of a typical 40-move game at REVIEW_DEPTH,
// using the bundled Stockfish binary through tests/node-stockfish.mjs.
// Run: node tools/time-review.mjs
import { START_FEN } from '../src/engine.js';
import { buildReview, replayGame, analyseGame, REVIEW_DEPTH } from '../src/review.js';
import { createNodeEngine } from '../tests/node-stockfish.mjs';

// A legal 40-move (80 ply) game from the initial position, produced with the
// built-in bot so the review timing uses a typical middlegame length.
const PGN_UCI = `
b2b3 e7e5 c1b2 b8c6 e2e3 g8f6 g1f3 e5e4 f3e5 c6e5 b2e5 f6d5 b1c3 d8g5 e5d4 d5c3
d4c3 f8d6 d1e2 e8g8 e2b5 g5g4 b5d5 g8h8 c3d4 g4g6 d5a5 g6h6 g2g3 a7a6 a5f5 h6e6
f5e6 d7e6 f1c4 e6e5 d4c3 c8g4 h1g1 a8a7 a1b1 h8g8 b1b2 f8d8 g1g2 g4f3 g2g1 d6e7
c3e5 e7b4 e5d4 c7c5 a2a3 b4a3 b2a2 a3b4 c2c3 c5d4 c3b4 d4e3 f2e3 d8d6 g1f1 a7a8
f1f2 a8c8 d2d4 d6b6 a2a4 g8f8 e1d2 c8c7 d2c3 b6d6 f2a2 c7c6 a2d2 b7b5 a4a1 b5c4
`.trim().split(/\s+/);

const uci = PGN_UCI;
console.log(`Moves in the sample game: ${uci.length} half-moves (${uci.length / 2} full moves).`);
const replayed = replayGame(START_FEN, uci);
console.log(`Replay is legal. Final FEN: ${replayed.positions.at(-1).toFen()}`);
console.log(`Final result: mate=${replayed.positions.at(-1).isCheckmate()} turn=${replayed.positions.at(-1).turn}`);

const engine = createNodeEngine();
const t0 = Date.now();
let evals;
try {
  let last = t0;
  evals = await analyseGame(engine, replayed, {
    depth: REVIEW_DEPTH,
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) {
        console.log(`  ${done}/${total} in ${Date.now() - last} ms (total ${Date.now() - t0} ms)`);
        last = Date.now();
      }
    },
  });
  const review = buildReview({
    startFen: START_FEN, uci, mode: 'local', depth: REVIEW_DEPTH, name: 'Timing game', evals,
  });
  const ms = Date.now() - t0;
  const acc = review.accuracy;
  console.log(`Review finished in ${ms} ms (${(ms / 1000).toFixed(1)} s) for ${uci.length} half-moves at depth ${REVIEW_DEPTH}.`);
  console.log(`Accuracy White ${acc.w && acc.w.toFixed(1)}, Black ${acc.b && acc.b.toFixed(1)}. Personal puzzles: ${review.mistakes.length}.`);
  console.log(`Judgments: ${JSON.stringify(review.counts)}`);
} finally {
  engine.quit();
}
