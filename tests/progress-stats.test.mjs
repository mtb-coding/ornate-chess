// Progress statistics aggregation tests.
// Run: node tests/progress-stats.test.mjs
import assert from 'node:assert/strict';
import {
  emptyBucket, cloneBucket, addOutcome, outcomeFromResult,
  curatedPuzzleAccuracy, generatedPuzzleAccuracy, mistakePuzzleAccuracy, endgameCompletion,
  resultsByLevel, resultsByColor, resultsByOpening, ratingSeries, buildProgress, sanitizeRating, openingStatsKey,
} from '../src/progress-stats.js';
import { ENDGAMES, ENDGAME_CATEGORIES } from '../src/data/endgames.js';
import { START_RATING } from '../src/rating.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`FAIL  ${name}\n  ${e.message}`); }
}

test('outcomeFromResult reads wins, draws and losses from the player\'s point of view', () => {
  assert.equal(outcomeFromResult('1-0', 'w'), 'wins');
  assert.equal(outcomeFromResult('0-1', 'w'), 'losses');
  assert.equal(outcomeFromResult('0-1', 'b'), 'wins');
  assert.equal(outcomeFromResult('1/2-1/2', 'w'), 'draws');
  assert.equal(outcomeFromResult('1-0', 'x'), null);
  assert.equal(outcomeFromResult('*', 'w'), null);
});

test('cloneBucket sanitizes damaged values', () => {
  const b = cloneBucket({ wins: '3', draws: -1, losses: 2.9, games: Infinity });
  assert.deepEqual(b, { wins: 0, draws: 0, losses: 2, games: 2 });
  assert.deepEqual(cloneBucket(null), emptyBucket());
});

test('curated puzzle accuracy is grouped by difficulty and ignores unattempted puzzles', () => {
  const puzzles = [
    { id: 'a', difficulty: 1 }, { id: 'b', difficulty: 1 }, { id: 'c', difficulty: 2 }, { id: 'd', difficulty: 2 },
  ];
  const progress = { puzzles: { a: { solved: true, attempts: 1 }, c: { solved: false, attempts: 3 }, z: { solved: true, attempts: 1 } } };
  const r = curatedPuzzleAccuracy(puzzles, progress);
  assert.equal(r.attempted, 2);
  assert.equal(r.solved, 1);
  assert.equal(r.accuracyPct, 50);
  assert.equal(r.levels[0].solved, 1);
  assert.equal(r.levels[0].attempted, 1);
  assert.equal(r.levels[1].solved, 0);
  assert.equal(r.levels[1].attempted, 1);
  assert.equal(r.levels[2].attempted, 0);
});

test('generated puzzle accuracy sanitizes by-level counts', () => {
  const r = generatedPuzzleAccuracy({
    solved: 4, attempted: 10, streak: 2, best: 5,
    byLevel: { easy: { solved: 3, attempted: 4 }, medium: { solved: 'x', attempted: 6 }, hard: null },
  });
  assert.equal(r.levels[0].solved, 3);
  assert.equal(r.levels[0].attempted, 4);
  assert.equal(r.levels[1].solved, 0);
  assert.equal(r.levels[1].attempted, 6);
  assert.equal(r.levels[2].attempted, 0);
  assert.equal(r.solved, 3);
  assert.equal(r.attempted, 10);
});

test('endgame completion is counted by category', () => {
  const r = endgameCompletion(ENDGAMES, ENDGAME_CATEGORIES, {
    positions: { 'queen-mate': { completed: true, attempts: 1 }, 'lucena': { completed: false, attempts: 2 } },
  });
  assert.equal(r.total, ENDGAMES.length);
  assert.equal(r.completed, 1);
  assert.equal(r.attempted, 2);
  const mates = r.groups.find((g) => g.id === 'mates');
  const rooks = r.groups.find((g) => g.id === 'rooks');
  assert.equal(mates.completed, 1);
  assert.equal(rooks.completed, 0);
  assert.ok(mates.total >= 4);
});

test('results by level keep the difficulty order and drop empty unknown keys', () => {
  const diffs = [{ id: 'lvl1', name: 'Novice' }, { id: 'lvl2', name: 'Beginner' }];
  const rows = resultsByLevel({ byLevel: { lvl2: { wins: 2, draws: 0, losses: 1, games: 3 }, ghost: { wins: 0, draws: 0, losses: 0, games: 0 } } }, diffs);
  assert.equal(rows[0].id, 'lvl1');
  assert.equal(rows[0].games, 0);
  assert.equal(rows[1].name, 'Beginner');
  assert.equal(rows[1].wins, 2);
  assert.equal(rows.some((r) => r.id === 'ghost'), false);
});

test('results by colour use the stored buckets and otherwise fall back to saved games', () => {
  const stored = resultsByColor({ byColor: { w: { wins: 2, draws: 1, losses: 0, games: 3 }, b: { wins: 0, draws: 0, losses: 1, games: 1 } } });
  assert.equal(stored.w.wins, 2);
  assert.equal(stored.b.losses, 1);
  const saved = [
    { mode: 'bot', playerColor: 'w', game: { resultInfo: { result: '1-0' } } },
    { mode: 'bot', playerColor: 'b', game: { resultInfo: { result: '1-0' } } },
    { mode: 'local', playerColor: 'w', game: { resultInfo: { result: '1-0' } } },
  ];
  const fallback = resultsByColor({ byColor: {} }, saved);
  assert.equal(fallback.w.wins, 1);
  assert.equal(fallback.b.losses, 1);
  assert.equal(fallback.w.games, 1);
});

test('results by opening come from saved bot games', () => {
  const Game = { fromJSON(obj) { return obj._game; } };
  const identify = (game) => game.opening;
  const saved = [
    { mode: 'bot', playerColor: 'w', game: { resultInfo: { result: '1-0' }, _game: { opening: { name: 'Sicilian Defence', eco: 'B20' } } } },
    { mode: 'bot', playerColor: 'w', game: { resultInfo: { result: '0-1' }, _game: { opening: { name: 'Sicilian Defence', eco: 'B20' } } } },
    { mode: 'bot', playerColor: 'b', game: { resultInfo: { result: '0-1' }, _game: { opening: null } } },
  ];
  const rows = resultsByOpening({ savedRecords: saved, Game, identifyOpeningForGame: identify });
  const sic = rows.find((r) => r.name === 'Sicilian Defence');
  const other = rows.find((r) => /Other games/.test(r.name));
  assert.equal(sic.games, 2);
  assert.equal(sic.wins, 1);
  assert.equal(sic.losses, 1);
  assert.equal(sic.eco, 'B20');
  assert.equal(other.wins, 1);
});

test('opening results from saved games are not added again from stored buckets', () => {
  const Game = { fromJSON(obj) { return obj._game; } };
  const identify = (game) => game.opening;
  const saved = [
    { mode: 'bot', playerColor: 'w', game: { resultInfo: { result: '1-0' }, _game: { opening: { name: 'Sicilian Defence', eco: 'B20' } } } },
    { mode: 'bot', playerColor: 'w', game: { resultInfo: { result: '0-1' }, _game: { opening: { name: 'Sicilian Defence', eco: 'B20' } } } },
  ];
  const stats = { byOpening: { 'Sicilian Defence': { name: 'Sicilian Defence', eco: 'B20', wins: 1, draws: 0, losses: 1, games: 2 } } };
  const rows = resultsByOpening({ stats, savedRecords: saved, Game, identifyOpeningForGame: identify });
  const sic = rows.find((r) => r.name === 'Sicilian Defence');
  assert.equal(rows.length, 1);
  assert.equal(sic.games, 2);
  assert.equal(sic.wins, 1);
  assert.equal(sic.losses, 1);
});

test('stored opening buckets are used when no saved bot games exist', () => {
  const stats = { byOpening: { 'Ruy Lopez': { name: 'Ruy Lopez', eco: 'C60', wins: 2, draws: 0, losses: 0, games: 2 } } };
  const rows = resultsByOpening({ stats, savedRecords: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ruy Lopez');
  assert.equal(rows[0].eco, 'C60');
  assert.equal(rows[0].wins, 2);
  assert.equal(rows[0].games, 2);
});

test('opening results keep stored games after the first saved game is added', () => {
  const Game = { fromJSON(obj) { return obj._game; } };
  const identify = (game) => game.opening;
  const saved = [
    { mode: 'bot', playerColor: 'w', game: { resultInfo: { result: '1-0' }, _game: { opening: { name: 'Sicilian Defence', eco: 'B20' } } } },
  ];
  const stats = { byOpening: { 'Sicilian Defence': { name: 'Sicilian Defence', eco: 'B20', wins: 3, draws: 0, losses: 1, games: 4 } } };
  const rows = resultsByOpening({ stats, savedRecords: saved, Game, identifyOpeningForGame: identify });
  const sic = rows.find((r) => r.name === 'Sicilian Defence');
  assert.equal(sic.games, 4);
  assert.equal(sic.wins, 3);
  assert.equal(sic.losses, 1);
});


test('openingStatsKey prefers the ECO code over the display name', () => {
  assert.equal(openingStatsKey({ name: 'Sicilian Defence', eco: 'B20' }), 'B20');
  assert.equal(openingStatsKey({ name: 'Sicilian Defense', eco: 'B20' }), 'B20');
  assert.equal(openingStatsKey({ name: 'Unnamed line', eco: '' }), 'name:Unnamed line');
});

test('opening results with the same ECO and different names are counted once', () => {
  const Game = { fromJSON(obj) { return obj._game; } };
  const identify = (game) => game.opening;
  const saved = [
    { mode: 'bot', playerColor: 'w', game: { resultInfo: { result: '1-0' }, _game: { opening: { name: 'Sicilian Defence', eco: 'B20' } } } },
    { mode: 'bot', playerColor: 'w', game: { resultInfo: { result: '1-0' }, _game: { opening: { name: 'Sicilian Defense', eco: 'B20' } } } },
  ];
  const stats = { byOpening: { 'Sicilian Defence': { name: 'Sicilian Defence', eco: 'B20', wins: 1, draws: 0, losses: 0, games: 1 } } };
  const rows = resultsByOpening({ stats, savedRecords: saved, Game, identifyOpeningForGame: identify });
  const sic = rows.filter((r) => r.eco === 'B20');
  assert.equal(sic.length, 1);
  assert.equal(sic[0].games, 2);
  assert.equal(sic[0].wins, 2);
});

test('corrupt stats values are rejected rather than shown', () => {
  const r = sanitizeRating({ rating: 1284, games: -1, wins: 'yes', draws: 0, losses: 0, peak: 1284 });
  assert.equal(r.games, 0);
  assert.equal(r.wins, 0);
  const curated = curatedPuzzleAccuracy(
    [{ id: 'a', difficulty: 1 }, { id: 'b', difficulty: 1 }],
    { puzzles: { a: { solved: 'yes', attempts: 1 }, b: { solved: true, attempts: 1 } } },
  );
  assert.equal(curated.solved, 1);
  assert.equal(curated.attempted, 2);
  const mistakes = mistakePuzzleAccuracy([
    { id: 'a', solved: 'yes', attempts: 1 },
    { id: 'b', solved: true, attempts: 1 },
  ]);
  assert.equal(mistakes.solved, 1);
  assert.equal(mistakes.attempted, 2);
  const end = endgameCompletion(
    [{ id: 'queen-mate', category: 'mates' }, { id: 'lucena', category: 'rooks' }],
    [{ id: 'mates', name: 'Mates' }, { id: 'rooks', name: 'Rooks' }],
    { positions: { 'queen-mate': { completed: 'no', attempts: 1 }, lucena: { completed: true, attempts: 1 } } },
  );
  assert.equal(end.completed, 1);
  const p = buildProgress({ playerRating: { rating: 1500, games: -1, wins: 2, draws: 0, losses: 0, peak: 1500, history: [] } });
  assert.equal(p.playerRating.games, 0);
});

test('mistake puzzle accuracy counts only attempted personal puzzles', () => {
  const r = mistakePuzzleAccuracy([
    { id: 'a', solved: true, attempts: 1 },
    { id: 'b', solved: false, attempts: 2 },
    { id: 'c', solved: false, attempts: 0 },
    { id: 'd' },
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.attempted, 2);
  assert.equal(r.solved, 1);
  assert.equal(r.accuracyPct, 50);
  assert.equal(mistakePuzzleAccuracy([]).attempted, 0);
  assert.equal(mistakePuzzleAccuracy(null).attempted, 0);
});

test('ratingSeries starts at 1200 and ignores a missing history', () => {
  assert.deepEqual(ratingSeries({ history: [] }), []);
  const pts = ratingSeries({ history: [{ at: 1, rating: 1230, delta: 30 }, { at: 2, rating: 1210, delta: -20 }] }, START_RATING);
  assert.equal(pts.length, 3);
  assert.equal(pts[0].rating, 1200);
  assert.equal(pts[2].rating, 1210);
});

test('buildProgress produces a complete empty state from blank inputs', () => {
  const p = buildProgress({});
  assert.equal(p.ratingPoints.length, 0);
  assert.equal(p.totals.games, 0);
  assert.equal(p.byColor.w.games, 0);
  assert.equal(p.curated.attempted, 0);
  assert.equal(p.generated.attempted, 0);
  assert.equal(p.mistakes.attempted, 0);
  assert.equal(p.endgames.completed, 0);
});

console.log(`\nProgress stats tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
