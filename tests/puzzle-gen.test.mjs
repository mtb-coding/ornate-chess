// Tests for the procedural puzzle generator (src/puzzle-gen.js).
// Run: node tests/puzzle-gen.test.mjs
import { Position } from '../src/engine.js';
import { Board } from '../src/engine.js';
import fs from 'node:fs';
import { createNodeEngine } from './node-stockfish.mjs';
import { verifyWithEngine } from '../src/puzzle-verify.js';
import { scanGame, generatePuzzle, verifyGenerated, puzzleFromCode, puzzleFromCodeVerified, applyVerification, GeneratedSession, classifyLine, searchRoot, LEVELS, levelOf, themeLabel } from '../src/puzzle-gen.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }
const SENTENCE = /^[A-Z][^!]*[.]$/;

// ---- Collect puzzles from fixed seeds, checked by the engine ----
const engines = [createNodeEngine(), createNodeEngine(), createNodeEngine()];
const t0 = Date.now();
const puzzles = [];
const timing = [];
await Promise.all(['easy', 'medium', 'hard'].map(async (level, i) => {
  const count = level === 'easy' ? 6 : 2;
  for (let k = 0; k < count; k++) {
    const start = Date.now();
    const r = await generatePuzzle({ seed: 20261121 + level.length * 31 + k * 977, level, engine: engines[i], maxGames: 400, timeBudgetMs: 150000 });
    timing.push(`${level}: ${Date.now() - start} ms, ${r.puzzle ? r.puzzle.games : '-'} games`);
    check(`generatePuzzle returns a ${level} puzzle`, r.puzzle && r.puzzle.level === level, r.puzzle ? `got ${r.puzzle.level}` : 'none');
    if (r.puzzle) puzzles.push(r.puzzle);
  }
}));
console.log(`Collected ${puzzles.length} puzzles in ${Date.now() - t0} ms (${timing.join('; ')}).`);
check('at least 10 puzzles were generated', puzzles.length >= 10, String(puzzles.length));

// ---- Every puzzle: legal, engine-checked, labelled ----
const levels = { easy: 0, medium: 0, hard: 0 };
const themes = {};
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const count = (ps, c) => ps.board.reduce((s, x) => s + (x && x.color === c ? VAL[x.type] : 0), 0);
for (const p of puzzles) {
  levels[p.level]++;
  themes[p.theme] = (themes[p.theme] || 0) + 1;
  let pos = Position.fromFen(p.fen);
  let legal = true;
  for (const u of p.solution) { const m = pos.parseUci(u); if (!m) { legal = false; break; } pos = pos.makeMove(m); }
  check(`${p.code}: solution is legal`, legal, p.solution.join(' '));
  check(`${p.code}: the solver makes the last move`, p.solution.length % 2 === 1);
  if (p.mateIn) check(`${p.code}: mate line ends in checkmate`, pos.isCheckmate());
  else {
    const side = p.fen.split(' ')[1], other = side === 'w' ? 'b' : 'w';
    const start = Position.fromFen(p.fen);
    const d0 = count(start, side) - count(start, other), d1 = count(pos, side) - count(pos, other);
    check(`${p.code}: the line wins material`, d1 - d0 >= 1 || p.gain >= 250, `${d0} -> ${d1}`);
  }
  // Independent re-check at a greater depth with the same margins.
  const v = await verifyWithEngine(p, engines[0], { depth: 20, replyTolerance: 150 });
  check(`${p.code}: the engine confirms a unique solution at depth 20`, v.ok, v.reason);
  if (p.mateIn) {
    const m = verifyGenerated(p, LEVELS[p.level].depth + 2, 8000000);
    check(`${p.code}: no other first move forces mate as quickly`, m.ok, m.errors.join('; '));
  }
  check(`${p.code}: has a theme label`, typeof p.title === 'string' && p.title.length > 2, p.title);
  check(`${p.code}: explanation is complete sentences`, p.explanation.split(/(?<=\.)\s+/).every((x) => SENTENCE.test(x)), p.explanation);
  check(`${p.code}: level matches its features`, levelOf(p) === p.level);
}
console.log('Levels:', JSON.stringify(levels), 'Themes:', JSON.stringify(themes));

// ---- Known non-unique positions must be rejected ----
// Each position was found by an independent engine check of earlier generator
// output: a second move scored almost as well, the stored move was not the
// best one, or the solver was not clearly winning. The check fails if the
// uniqueness rules in src/puzzle-verify.js are weakened or removed.
{
  const bad = JSON.parse(fs.readFileSync(new URL('./fixtures/non-unique-puzzles.json', import.meta.url)));
  const results = await Promise.all(engines.map(async (eng, i) => {
    const out = [];
    for (let k = i; k < bad.length; k += engines.length) out.push([bad[k], await verifyWithEngine(bad[k], eng), await verifyWithEngine(bad[k], eng, { gap: -1e9, win: -1e9, altWin: 1e9 })]);
    return out;
  }));
  const rows = results.flat();
  const accepted = rows.filter(([, v]) => v.ok).map(([f]) => f.code);
  check(`all ${bad.length} known non-unique positions are rejected`, accepted.length === 0, accepted.join(', '));
  const gapCases = rows.filter(([f]) => f.why.startsWith('second move'));
  const looseAccepted = gapCases.filter(([, , loose]) => loose.ok).length;
  check('the margin rules are what rejects the near-tie positions', gapCases.length >= 10 && looseAccepted >= gapCases.length * 0.5, `${looseAccepted} of ${gapCases.length} accepted without the margin rules`);
}

// ---- Seeded replay ----
for (const p of puzzles.slice(0, 5)) {
  const again = puzzleFromCode(p.code);
  check(`${p.code}: the code rebuilds the same puzzle`, again && again.fen === p.fen && again.solution.join() === p.solution.join());
}
check('an invalid code returns null', puzzleFromCode('x123') === null && puzzleFromCode('m12') === null);
const a = scanGame(424242, 'medium'), b = scanGame(424242, 'medium');
check('scanGame is deterministic for a seed', JSON.stringify(a) === JSON.stringify(b));

// ---- Session behaviour ----
{
  const p = puzzles.find((x) => x.solution.length >= 3) || puzzles[0];
  const s = new GeneratedSession(p);
  const start = s.position.toFen();
  const wrong = s.position.legalMoves().find((m) => s.position.moveToUci(m) !== p.solution[0] && !((p.alternatives[0] || []).includes(s.position.moveToUci(m))));
  check('session: a wrong move is rejected', s.tryMove(wrong).status === 'wrong');
  check('session: a wrong move leaves the position unchanged', s.position.toFen() === start);
  let last;
  for (let i = 0; i < p.solution.length; i += 2) last = s.tryMove(p.solution[i]);
  check('session: the solution completes the puzzle', last.status === 'complete' && s.complete);
  const s2 = new GeneratedSession(p);
  const h1 = s2.hint(), h2 = s2.hint();
  const first = s2.position.parseUci(p.solution[0]);
  check('session: hints show the piece and then the move', h1.from === first.from && h1.to === undefined && h2.to === first.to);
  check('session: remaining() lists the full solution', s2.remaining().length === p.solution.length);
}
{
  const p = { fen: '6k1/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1', solution: ['a1a8'], alternatives: [['e1e8']], mateIn: 1 };
  const s = new GeneratedSession(p);
  check('session: an alternative mate is accepted', s.tryMove('e1e8').status === 'complete');
}

// ---- Theme detection and search on known positions ----
{
  const forkFen = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';
  const pos = Position.fromFen(forkFen);
  const code = pos.moveCode(pos.parseUci('b5c7'));
  check('fork detection: Nc7+ forks king and rook', classifyLine(forkFen, [code], 0).theme === 'fork');
  const r = searchRoot(Board.fromFen(forkFen), 3);
  check('search finds the fork', pos.moveToUci(pos.codeToMove(r.move)) === 'b5c7', String(r.score));
  const mateFen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
  const mp = Position.fromFen(mateFen);
  const cl = classifyLine(mateFen, [mp.moveCode(mp.parseUci('a1a8'))], 1);
  check('back-rank mate is labelled', cl.theme === 'mate-in-1' && cl.sub === 'back-rank' && themeLabel(cl.theme, cl.sub) === 'Mate in one (back-rank mate)');
}


// ---- Rebuilt codes must not show a uniqueness claim unless the engine agrees ----
{
  const CLAIM = /estimates that every other first move is at least two pawns worse|rates every other first move at least two pawns/;
  for (const code of ['e16.g', 'e70b.5']) {
    const raw = puzzleFromCode(code);
    check(`${code}: the code still rebuilds a position`, !!(raw && raw.fen && raw.solution && raw.solution.length));
    if (!raw) continue;
    const checked = await puzzleFromCodeVerified(code, engines[0]);
    check(`${code}: the engine check does not accept the rebuilt puzzle`, checked && checked.verified === false, checked && checked.explanation);
    check(`${code}: the uniqueness claim is removed`, checked && !CLAIM.test(checked.explanation), checked && checked.explanation);
    check(`${code}: the explanation is still complete sentences`, checked && checked.explanation.split(/(?<=\.)\s+/).every((x) => SENTENCE.test(x)), checked && checked.explanation);
  }
  const good = puzzles.find((p) => !p.mateIn && p.verified);
  if (good) {
    const again = await puzzleFromCodeVerified(good.code, engines[0]);
    check('a verified generated puzzle still has the uniqueness claim after a checked rebuild', again && again.verified === true && CLAIM.test(again.explanation));
  }
}

console.log(`\nPuzzle generator tests: ${pass} passed, ${fail} failed`);
engines.forEach((e) => e.quit());
process.exit(fail ? 1 : 0);
