// Engine regression test for the review pipeline. It runs the same engine
// pass as the page (analyseGame with the bundled Stockfish 19 lite build at
// REVIEW_DEPTH) on a game whose earlier screenshot showed hand-written test
// data instead of engine output, and checks the labels against Stockfish and
// the lichess cloud evaluation (depth 48 on 2026-11-23: 7...g5 -0.27 best,
// 8.Bg3 -0.20, 8.Nxg5 -1.02). Run: node tests/review-engine.test.mjs
import { START_FEN } from '../src/engine.js';
import { buildReview, replayGame, analyseGame, REVIEW_DEPTH } from '../src/review.js';
import { createNodeEngine } from './node-stockfish.mjs';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
}

const UCI = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 d2d3 g8f6 b1c3 d7d6 c1g5 h7h6 g5h4 g7g5 f3g5'.split(' ');
// Hash sizes used by the page (8 MB) and by the Node tools (16 MB).
for (const hash of [8, 16]) {
  const engine = createNodeEngine(undefined, { hash });
  try {
    const replayed = replayGame(START_FEN, UCI);
    const evals = await analyseGame(engine, replayed, { depth: REVIEW_DEPTH });
    const raw = evals.slice(13, 16).map((e, k) => `ply ${13 + k}: ${e.lines.map((l) => `${l.move} ${l.kind} ${l.value}`).join(' | ')}`);
    console.log(`hash ${hash} MB, depth ${REVIEW_DEPTH}:\n  ${raw.join('\n  ')}`);
    check(`hash ${hash}: every engine line carries a principal variation`, evals.every((e) => e.lines.every((l) => !l.move || (Array.isArray(l.pv) && l.pv[0] === l.move))));
    // 7...g5 and 7...a6 are within a few centipawns at every depth, so the
    // order of the two lines may change; 7...g5 must be one of them.
    const g5Line = evals[13].lines.find((l) => l.move === 'g7g5');
    check(`hash ${hash}: after 7.Bh4 7...g5 is one of the engine's two top lines, within 30 cp of the best`, !!g5Line && evals[13].lines[0].value - g5Line.value <= 30, evals[13].lines.map((l) => l.move + ' ' + l.value).join(' | '));
    check(`hash ${hash}: after 7...g5 the engine prefers 8.Bg3`, evals[14].lines[0].move === 'h4g3', evals[14].lines[0].move);
    const r = buildReview({ startFen: START_FEN, uci: UCI, mode: 'local', depth: REVIEW_DEPTH, evals });
    const g5 = r.moves[13], nxg5 = r.moves[14];
    check(`hash ${hash}: 7...g5 is not a Mistake, Miss or Blunder`, !['mistake', 'miss', 'blunder', 'inaccuracy'].includes(g5.judgment), `${g5.judgment} ${g5.evalAfter.whiteCp}`);
    check(`hash ${hash}: 7...g5 keeps the evaluation near equal`, Math.abs(g5.evalAfter.whiteCp) < 100, String(g5.evalAfter.whiteCp));
    check(`hash ${hash}: 7...g5 has no red refutation arrow`, !g5.threatUci, String(g5.threatUci));
    check(`hash ${hash}: 8.Nxg5 is not Best, Excellent, Great or Brilliant`, !['best', 'excellent', 'great', 'brilliant'].includes(nxg5.judgment), nxg5.judgment);
    check(`hash ${hash}: 8.Nxg5 is flagged`, ['inaccuracy', 'mistake', 'blunder'].includes(nxg5.judgment), nxg5.judgment);
    check(`hash ${hash}: after 8.Nxg5 Black is better`, nxg5.evalAfter.whiteCp < -50, String(nxg5.evalAfter.whiteCp));
    check(`hash ${hash}: the evaluation graph has no spike at 7...g5`, r.positions.slice(12, 16).every((p) => Math.abs(p.whiteCp) < 200), r.positions.slice(12, 16).map((p) => p.whiteCp).join(','));
  } finally {
    engine.quit();
  }
}

console.log(`\nReview engine tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
