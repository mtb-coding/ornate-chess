// Isolation tests for the uniqueness rules in src/puzzle-verify.js.
// Each fixture is rejected by exactly one rule, so that removing that rule
// alone makes the matching test fail. Run: node tests/puzzle-verify.test.mjs
import { verifyWithEngine } from '../src/puzzle-verify.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const puzzle = (uci = 'e2e4') => ({ fen: START, solution: [uci], mateIn: 0 });
const line = (move, value) => ({ move, kind: 'cp', value });
const engine = (lines) => ({ analyse: async () => lines });

// Gap rule only: the solution is the top move and is winning, the second
// move is not itself a win, but the gap is under 200 centipawns.
const GAP_ONLY = [line('e2e4', 250), line('e2e3', 80)];
// Also-wins rule only: the gap is at least 200, but the second move still
// wins (above 300) and the gap is under the 400-centipawn also-wins margin.
const ALT_ONLY = [line('e2e4', 900), line('e2e3', 550)];
// Top-move rule only: the stored solution is not the engine's first choice,
// but the engine's own top two moves would pass the win, gap and also-wins rules.
const TOP_ONLY = [line('d2d4', 800), line('e2e3', 200)];

const v = (lines, opts) => verifyWithEngine(puzzle(), engine(lines), opts || {});

{
  const rejected = await v(GAP_ONLY);
  check('a near-tie that is not itself winning is rejected', !rejected.ok, rejected.reason);
  check('that near-tie is accepted when only the gap rule is disabled', (await v(GAP_ONLY, { gap: -1e9 })).ok);
  check('that near-tie stays rejected when only the also-wins rule is disabled', !(await v(GAP_ONLY, { altWin: 1e9 })).ok);
  check('that near-tie stays rejected when the win threshold is lowered', !(await v(GAP_ONLY, { win: -1e9 })).ok);
}

{
  const rejected = await v(ALT_ONLY);
  check('a second move that also wins is rejected', !rejected.ok, rejected.reason);
  check('that second win is accepted when only the also-wins rule is disabled', (await v(ALT_ONLY, { altWin: 1e9 })).ok);
  check('that second win stays rejected when only the gap rule is disabled', !(await v(ALT_ONLY, { gap: -1e9 })).ok);
  check('that second win stays rejected when the win threshold is lowered', !(await v(ALT_ONLY, { win: -1e9 })).ok);
}

{
  const rejected = await v(TOP_ONLY);
  check('a stored move that is not the engine top move is rejected', !rejected.ok, rejected.reason);
  // There is no option to turn off the top-move rule. The fixture is built so
  // that the remaining rules would accept the engine's own top two lines; if
  // the top-move check is deleted from verifyWithEngine, this test fails.
  const engineTop = { fen: START, solution: ['d2d4'], mateIn: 0 };
  const asTop = await verifyWithEngine(engineTop, engine(TOP_ONLY));
  check('the same lines are accepted when the stored move is the engine top move', asTop.ok, asTop.reason);
  check('the wrong stored move stays rejected when the gap and also-wins rules are disabled', !(await v(TOP_ONLY, { gap: -1e9, altWin: 1e9 })).ok);
}

console.log(`\nPuzzle verifier isolation tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
