/**
 * Puzzle database and PuzzleSession tests.
 * Every puzzle is machine-verified against engine.js.
 */
import assert from 'node:assert/strict';
import { Position } from '../src/engine.js';
import { PUZZLES, PuzzleSession, nextPuzzle, verifyPuzzle } from '../src/puzzles.js';
import * as T from '../tools/puzzle-tactics.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n  ${e.message}`);
  }
}

const REQUIRED_THEMES = [
  'mate-in-1', 'mate-in-2', 'mate-in-3', 'mate-in-4', 'fork', 'pin', 'skewer',
  'back-rank', 'discovered', 'sacrifice', 'endgame', 'promotion',
  'deflection', 'zugzwang-ish',
];

test('at least 115 puzzles', () => {
  assert.ok(PUZZLES.length >= 115, `only ${PUZZLES.length}`);
});

test('all required themes present', () => {
  const themes = new Set(PUZZLES.map((p) => p.theme));
  for (const t of REQUIRED_THEMES) {
    assert.ok(themes.has(t), `missing theme ${t}`);
  }
});

test('difficulties 1..5 all represented', () => {
  const diffs = new Set(PUZZLES.map((p) => p.difficulty));
  for (let d = 1; d <= 5; d++) assert.ok(diffs.has(d), `missing difficulty ${d}`);
});

test('ids are unique', () => {
  const ids = PUZZLES.map((p) => p.id);
  assert.equal(ids.length, new Set(ids).size);
});

test('each puzzle has required fields and honest rating band', () => {
  for (const p of PUZZLES) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.title, 'string');
    assert.ok(p.title.length > 0);
    assert.ok(REQUIRED_THEMES.includes(p.theme), p.theme);
    assert.ok(p.difficulty >= 1 && p.difficulty <= 5);
    assert.equal(typeof p.rating, 'number');
    // Honest band: roughly 700..2300 by difficulty
    const lo = 700 + (p.difficulty - 1) * 150;
    const hi = 1100 + p.difficulty * 250;
    assert.ok(p.rating >= lo && p.rating <= hi, `${p.id} rating ${p.rating} outside ${lo}-${hi}`);
    assert.equal(typeof p.fen, 'string');
    assert.ok(Array.isArray(p.solution) && p.solution.length > 0);
    assert.equal(typeof p.hint, 'string');
    assert.ok(p.hint.endsWith('.') || p.hint.length > 10, `${p.id} hint should be a complete sentence`);
    assert.equal(typeof p.explanation, 'string');
    assert.ok(p.explanation.length > 20, `${p.id} explanation too short`);
  }
});

let verifyFails = 0;
for (const p of PUZZLES) {
  test(`verify ${p.id}`, () => {
    const r = verifyPuzzle(p);
    assert.equal(r.ok, true, r.errors.join('; '));
  });
}

test('mate-in-N ends in checkmate in exactly N player moves', () => {
  for (const p of PUZZLES) {
    const n = { 'mate-in-1': 1, 'mate-in-2': 2, 'mate-in-3': 3, 'mate-in-4': 4 }[p.theme];
    if (!n) continue;
    let pos = Position.fromFen(p.fen);
    for (const u of p.solution) pos = pos.makeMove(pos.parseUci(u));
    assert.equal(pos.isCheckmate(), true, p.id);
    assert.equal(Math.ceil(p.solution.length / 2), n, p.id);
  }
});

test('mate-in-1 and back-rank uniqueness or listed alternatives cover all mating first moves', () => {
  for (const p of PUZZLES.filter((x) => x.theme === 'mate-in-1' || x.theme === 'back-rank')) {
    const pos = Position.fromFen(p.fen);
    const mates = pos
      .legalMoves()
      .filter((m) => pos.makeMove(m).isCheckmate())
      .map((m) => pos.moveToUci(m).toLowerCase());
    assert.ok(mates.includes(p.solution[0].toLowerCase()), `${p.id} solution not mating`);
    if (mates.length > 1) {
      const listed = new Set([
        p.solution[0].toLowerCase(),
        ...((p.alternatives && p.alternatives[0]) || []).map((u) => u.toLowerCase()),
      ]);
      for (const m of mates) {
        assert.ok(listed.has(m), `${p.id} missing alternative ${m}`);
      }
    }
  }
});

test('mate-in-2/3/4 first moves are forcing, and unique when listed as unique', () => {
  for (const p of PUZZLES) {
    const n = { 'mate-in-2': 2, 'mate-in-3': 3, 'mate-in-4': 4 }[p.theme];
    if (!n) continue;
    const pos = Position.fromFen(p.fen);
    const first = p.solution[0].toLowerCase();
    const mates = T.matingFirstMoves(pos, n).map((u) => u.toLowerCase());
    assert.ok(mates.includes(first), `${p.id} first move does not force mate in ${n}; found ${mates.join(',') || 'none'}`);
    if (mates.length > 1) {
      const listed = new Set([
        first,
        ...((p.alternatives && p.alternatives[0]) || []).map((u) => u.toLowerCase()),
      ]);
      for (const m of mates) {
        assert.ok(listed.has(m), `${p.id} missing alternative ${m}`);
      }
    }
  }
});

test('discovered-attack puzzles truly uncover a sliding attack', () => {
  const set = PUZZLES.filter((p) => p.theme === 'discovered');
  assert.ok(set.length >= 2, 'need discovered puzzles');
  for (const p of set) {
    const pos = Position.fromFen(p.fen);
    const first = pos.parseUci(p.solution[0]);
    assert.ok(T.isDiscoveredAttack(pos, first), `${p.id} is not a discovered attack`);
  }
});

test('fork puzzles attack two enemy units after the first move', () => {
  for (const p of PUZZLES.filter((x) => x.theme === 'fork')) {
    const pos = Position.fromFen(p.fen);
    const first = pos.parseUci(p.solution[0]);
    assert.ok(T.isFork(pos, first), `${p.id} is not a fork`);
  }
});

test('skewer puzzles skewer two enemy units on the first move', () => {
  for (const p of PUZZLES.filter((x) => x.theme === 'skewer')) {
    const pos = Position.fromFen(p.fen);
    const first = pos.parseUci(p.solution[0]);
    assert.ok(T.isSkewer(pos, first), `${p.id} is not a skewer`);
  }
});

test('pin puzzles create a pin or capture a pinned piece', () => {
  for (const p of PUZZLES.filter((x) => x.theme === 'pin')) {
    const pos = Position.fromFen(p.fen);
    const first = pos.parseUci(p.solution[0]);
    assert.ok(T.isPinMove(pos, first), `${p.id} is not a pin`);
  }
});

test('promotion puzzles promote on the first move', () => {
  for (const p of PUZZLES.filter((x) => x.theme === 'promotion')) {
    const pos = Position.fromFen(p.fen);
    const first = pos.parseUci(p.solution[0]);
    assert.ok(T.isPromotionMove(first), `${p.id} first move is not a promotion`);
  }
});

test('back-rank puzzles end in back-rank mate', () => {
  for (const p of PUZZLES.filter((x) => x.theme === 'back-rank')) {
    const line = T.playLine(p.fen, p.solution);
    assert.ok(line.ok && line.pos.isCheckmate(), `${p.id} line is not mate`);
    let last, cur = Position.fromFen(p.fen);
    for (const u of p.solution) { last = cur.parseUci(u); cur = cur.makeMove(last); }
    assert.ok(T.isBackRankMate(line.pos, last), `${p.id} is not a back-rank mate`);
  }
});

test('every solution line is legal', () => {
  for (const p of PUZZLES) {
    const line = T.playLine(p.fen, p.solution);
    assert.ok(line.ok, `${p.id} ${line.error}`);
  }
});

test('Advanced and Expert tiers are populated', () => {
  const d4 = PUZZLES.filter((p) => p.difficulty === 4).length;
  const d5 = PUZZLES.filter((p) => p.difficulty === 5).length;
  assert.ok(d4 >= 15, `only ${d4} Advanced puzzles`);
  assert.ok(d5 >= 15, `only ${d5} Expert puzzles`);
});

test('PuzzleSession solves main line', () => {
  const p = PUZZLES.find((x) => x.theme === 'mate-in-1');
  const s = new PuzzleSession(p);
  assert.equal(s.playerColor, p.fen.includes(' b ') ? 'b' : 'w');
  let status;
  // Play only player moves; session auto-plays replies
  // For mate-in-1, one move completes
  status = s.tryMove(p.solution[0]).status;
  assert.equal(status, 'complete');
});

test('PuzzleSession rejects wrong move', () => {
  const p = PUZZLES.find((x) => x.theme === 'mate-in-1' && x.solution[0] !== 'e2e4');
  const s = new PuzzleSession(p);
  // Pick a legal non-solution move if any
  const pos = Position.fromFen(p.fen);
  const wrong = pos.legalMoves().map((m) => pos.moveToUci(m)).find((u) => u !== p.solution[0]);
  if (!wrong) return;
  assert.equal(s.tryMove(wrong).status, 'wrong');
});

test('PuzzleSession accepts alternative mate', () => {
  const p = PUZZLES.find(
    (x) =>
      (x.theme === 'mate-in-1' || x.theme === 'back-rank') &&
      Array.isArray(x.alternatives?.[0]) &&
      x.alternatives[0].length > 1
  );
  assert.ok(p, 'need a multi-mate puzzle');
  const alt = p.alternatives[0].find((u) => u.toLowerCase() !== p.solution[0].toLowerCase());
  const s = new PuzzleSession(p);
  assert.equal(s.tryMove(alt).status, 'complete');
});

test('PuzzleSession hint stages', () => {
  const p = PUZZLES.find((x) => x.theme === 'mate-in-1');
  const s = new PuzzleSession(p);
  const h1 = s.hint();
  assert.equal(typeof h1.from, 'number');
  assert.equal(h1.to, undefined);
  const h2 = s.hint();
  assert.equal(typeof h2.to, 'number');
});

test('PuzzleSession reset restores start', () => {
  const p = PUZZLES.find((x) => x.theme === 'mate-in-2') || PUZZLES[0];
  const s = new PuzzleSession(p);
  s.tryMove(p.solution[0]);
  s.reset();
  assert.equal(s.position.toFen(), Position.fromFen(p.fen).toFen());
});

test('mate-in-2 session plays reply then completes', () => {
  const p = PUZZLES.find((x) => x.theme === 'mate-in-2');
  assert.ok(p);
  const s = new PuzzleSession(p);
  const r1 = s.tryMove(p.solution[0]);
  assert.ok(r1.status === 'correct' || r1.status === 'complete');
  if (r1.status === 'correct') {
    assert.ok(r1.reply);
    const r2 = s.tryMove(p.solution[2]);
    assert.equal(r2.status, 'complete');
  }
});

test('nextPuzzle prefers near rating and unsolved', () => {
  const progress = { rating: 1200, puzzles: {} };
  // mark half solved
  for (const p of PUZZLES.slice(0, Math.floor(PUZZLES.length / 2))) {
    progress.puzzles[p.id] = { solved: true };
  }
  const n = nextPuzzle(progress, {});
  assert.ok(n);
  assert.equal(progress.puzzles[n.id]?.solved, undefined);
});

test('nextPuzzle theme filter', () => {
  const n = nextPuzzle({ rating: 1400, puzzles: {} }, { theme: 'fork' });
  assert.ok(n);
  assert.equal(n.theme, 'fork');
});

test('nextPuzzle difficulty filter', () => {
  const n = nextPuzzle({ rating: 1000, puzzles: {} }, { difficulty: 1 });
  assert.ok(n);
  assert.equal(n.difficulty, 1);
});

console.log(`\nPuzzle tests: ${passed} passed, ${failed} failed (dataset ${PUZZLES.length})`);
if (failed) process.exit(1);
