// Opening recognition tests. Run: node tests/openings.test.mjs
import assert from 'node:assert/strict';
import { Position, Game, START_FEN } from '../src/engine.js';
import { OPENINGS, identifyOpening, identifyOpeningForGame, openingHeaders } from '../src/openings.js';
import { OPENINGS_COUNT, OPENINGS_SOURCE } from '../src/data/openings.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}\n  ${err.message}`); }
}
const id = (s) => identifyOpening(s.trim().split(/\s+/));

test('dataset is present and covers A00 to E99', () => {
  assert.equal(OPENINGS.length, OPENINGS_COUNT);
  assert.ok(OPENINGS.length > 3000, `only ${OPENINGS.length} entries`);
  assert.equal(OPENINGS_SOURCE.license, 'CC0-1.0');
  const ecos = new Set(OPENINGS.map((o) => o.eco));
  for (const l of 'ABCDE') assert.ok([...ecos].some((e) => e[0] === l), `no ${l} codes`);
  assert.ok(ecos.has('A00') && ecos.has('E99'));
  for (const o of OPENINGS) { assert.match(o.eco, /^[A-E]\d\d$/); assert.ok(o.name.length > 0); }
});

test('every dataset entry is a legal move sequence', () => {
  let bad = 0;
  for (const o of OPENINGS) {
    let p = Position.fromFen(START_FEN);
    for (const san of o.sans) { const m = p.parseSan(san); if (!m) { bad++; break; } p = p.makeMove(m); }
  }
  assert.equal(bad, 0, `${bad} illegal entries`);
});

test('dataset has no exact duplicates', () => {
  const s = new Set(OPENINGS.map((o) => `${o.eco}|${o.name}|${o.sans.join(' ')}`));
  assert.equal(s.size, OPENINGS.length);
});

test('Ruy Lopez: 1.e4 e5 2.Nf3 Nc6 3.Bb5 is C60', () => {
  const r = id('e4 e5 Nf3 Nc6 Bb5');
  assert.equal(r.eco, 'C60'); assert.equal(r.name, 'Ruy Lopez'); assert.equal(r.plies, 5); assert.equal(r.lastBookPly, 5); assert.equal(r.matchedBy, 'sequence');
});

test("Queen's Gambit: 1.d4 d5 2.c4", () => {
  const r = id('d4 d5 c4');
  assert.equal(r.eco, 'D06'); assert.equal(r.name, "Queen's Gambit");
});

test('UCI input gives the same result as SAN input', () => {
  assert.deepEqual(identifyOpening(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']), id('e4 e5 Nf3 Nc6 Bb5'));
});

test('Sicilian Najdorf is recognised as B90', () => {
  const r = id('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6');
  assert.equal(r.eco, 'B90'); assert.match(r.name, /Najdorf/);
});

test('transposition: 1.Nf3 Nf6 2.c4 e6 3.Nc3 d5 4.d4 reaches the QGD Three Knights position', () => {
  const r = id('Nf3 Nf6 c4 e6 Nc3 d5 d4');
  assert.equal(r.matchedBy, 'transposition');
  assert.equal(r.eco, 'D37'); assert.match(r.name, /Queen's Gambit Declined/);
  assert.equal(r.lastBookPly, 7);
});

test('transposition: 1.Nf3 d5 2.d4 matches the same opening as 1.d4 d5 2.Nf3', () => {
  const a = id('Nf3 d5 d4'), b = id('d4 d5 Nf3');
  assert.equal(a.eco, b.eco); assert.equal(a.name, b.name);
  assert.equal(a.matchedBy, 'transposition'); assert.equal(b.matchedBy, 'sequence');
});

test('leaving theory keeps the last named opening and reports lastBookPly', () => {
  const r = id('e4 e5 Nf3 Nc6 Bb5 a6 h4 h5 Rh3');
  assert.equal(r.eco, 'C70'); assert.match(r.name, /Morphy Defense/);
  assert.equal(r.lastBookPly, 6);
});

test('empty and unknown lines return null', () => {
  assert.equal(identifyOpening([]), null);
  assert.equal(identifyOpening(null), null);
  assert.equal(id('zz9'), null);
});

test('an illegal move stops matching at the last legal move', () => {
  const r = id('e4 e5 Nf3 Ke7x Bb5');
  assert.equal(r.lastBookPly, 3);
});

test('identifyOpeningForGame follows the viewed ply', () => {
  const g = new Game();
  for (const s of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) assert.ok(g.play(g.position.parseSan(s)));
  assert.equal(identifyOpeningForGame(g).eco, 'C70');
  assert.equal(identifyOpeningForGame(g, { ply: 5 }).eco, 'C60');
  assert.equal(identifyOpeningForGame(g, { ply: 0 }), null);
  assert.equal(identifyOpeningForGame(g, { ply: 1 }).name, "King's Pawn Game");
});

test('games from a custom FEN return null', () => {
  const g = new Game('7k/8/8/8/8/8/4K3/8 w - - 0 1');
  assert.equal(identifyOpeningForGame(g), null);
});

test('openingHeaders builds PGN header fields', () => {
  assert.deepEqual(openingHeaders(id('e4 e5 Nf3 Nc6 Bb5')), { ECO: 'C60', Opening: 'Ruy Lopez' });
  assert.deepEqual(openingHeaders(null), {});
});

test('every dataset line identifies itself (position index is consistent)', () => {
  let mismatch = 0;
  for (const o of OPENINGS) { const r = identifyOpening(o.sans); if (!r || r.name !== o.name || r.eco !== o.eco || r.lastBookPly !== o.sans.length) mismatch++; }
  assert.equal(mismatch, 0, `${mismatch} lines do not identify themselves`);
});

// Storage export adds the opening headers (additive change in storage.js).
{
  const st = await import('../src/storage.js');
  await st.ensureGameLoaded();
  const store = st.createStorage(new st.MemoryStorage());
  const g = new Game();
  for (const s of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) g.play(g.position.parseSan(s));
  const rec = { name: 'Opening header test', savedAt: Date.now(), mode: 'local', game: g.toJSON() };
  test('exportPgn writes ECO and Opening headers', () => {
    const pgn = store.exportPgn(rec);
    assert.match(pgn, /\[ECO "C60"\]/); assert.match(pgn, /\[Opening "Ruy Lopez"\]/);
    const back = store.importPgn(pgn); assert.deepEqual(back.game.uci, rec.game.uci);
  });
  test('exportPgn omits opening headers when nothing matches', () => {
    const pgn = store.exportPgn({ ...rec, game: new Game().toJSON() });
    assert.doesNotMatch(pgn, /\[ECO /); assert.doesNotMatch(pgn, /\[Opening /);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
