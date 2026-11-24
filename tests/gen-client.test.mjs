// Tests for the storage handling of the generated-puzzle client (src/ui/puzzle-gen-client.js).
// Run: node tests/gen-client.test.mjs
import { scanGame } from '../src/puzzle-gen.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const STATS = 'ornate-chess:gen-stats';
const POOL = 'ornate-chess:gen-pool-v2';
let n = 0;
const load = () => import(`../src/ui/puzzle-gen-client.js?t=${++n}`);

// ---- Statistics from damaged storage ----
{
  const { readStats, recordResult } = await load();
  const cases = {
    'text that is not JSON': 'not json',
    'an array': '[]',
    'null': 'null',
    'strings instead of numbers': '{"solved":"abc","streak":"x","best":"y"}',
    'an object as a number': '{"streak":{"a":1},"solved":[1]}',
    'an infinite number': '{"streak":1e999,"solved":1e999}',
    'negative numbers': '{"solved":-4,"streak":-2,"best":-1,"attempted":-9}',
    'a missing level table': '{"solved":2,"byLevel":null}',
    'level entries of the wrong type': '{"solved":2,"byLevel":{"easy":"x","medium":5,"hard":{"solved":"q","attempted":-1}}}',
    'fractions': '{"solved":2.9,"streak":1.5}',
  };
  for (const [name, raw] of Object.entries(cases)) {
    store.set(STATS, raw);
    const s = readStats();
    const nums = [s.solved, s.attempted, s.streak, s.best, ...Object.values(s.byLevel).flatMap((x) => [x.solved, x.attempted])];
    check(`stats: ${name} give whole non-negative numbers`, nums.every((v) => Number.isInteger(v) && v >= 0), JSON.stringify(s));
    check(`stats: ${name} keep best at least as large as the streak`, s.best >= s.streak);
  }
  store.set(STATS, '{"solved":"abc","streak":"x"}');
  const after = recordResult('easy', true);
  check('stats: a clean solve after damaged data stores numbers', after.solved === 1 && after.streak === 1 && JSON.parse(store.get(STATS)).solved === 1);
  store.set(STATS, JSON.stringify({ solved: 3, attempted: 4, streak: 2, best: 5, byLevel: {} }));
  const missed = recordResult('medium', false, false);
  check('stats: a failed puzzle resets the streak and keeps the best streak', missed.streak === 0 && missed.best === 5 && missed.attempted === 5 && missed.solved === 3);
}

// ---- Puzzle validation and the stored pool ----
{
  let good = null;
  for (let seed = 1; !good && seed < 200; seed++) good = scanGame(seed * 13, 'easy').find((p) => !p.mateIn) || null;
  const mod = await load();
  check('a generated puzzle is valid', mod.validPuzzle(good));
  const variants = {
    'a damaged position': { ...good, fen: 'abc' },
    'a position with an extra field': { ...good, fen: good.fen + ' x y z' },
    'an illegal solution move': { ...good, solution: ['a1a1'] },
    'a solution of even length': { ...good, solution: [...good.solution, 'a1a2'] },
    'a solution with a non-string': { ...good, solution: [null] },
    'an unknown level': { ...good, level: 'impossible' },
    'a missing code': { ...good, code: undefined },
    'a null entry': null,
    'a number': 5,
  };
  for (const [name, v] of Object.entries(variants)) check(`validation rejects ${name}`, !mod.validPuzzle(v));

  store.set(POOL, JSON.stringify({ easy: [{ ...good, fen: 'abc' }, null, [1], good, { fen: 5 }], medium: 'x', hard: null }));
  store.set('ornate-chess:gen-pool', JSON.stringify({ easy: [good] }));
  const fresh = await load();
  const gen = fresh.generator();
  check('the stored pool keeps only valid puzzles of the right level', gen.pool.easy.length === 1 && gen.pool.easy[0].code === good.code && gen.pool.medium.length === 0 && gen.pool.hard.length === 0);
  check('puzzles stored by the earlier version are removed', !store.has('ornate-chess:gen-pool'));
  gen.discard(good);
  check('discard removes a puzzle from the pool and from storage', gen.pool.easy.length === 0 && JSON.parse(store.get(POOL)).easy.length === 0);
}

console.log(`\nGenerated puzzle client tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
