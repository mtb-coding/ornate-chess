// Player rating tests: Elo math, rated/unrated rules and persistence.
// Run: node tests/rating.test.mjs
import assert from 'node:assert/strict';
import {
  START_RATING, PROVISIONAL_GAMES, expectedScore, kFactor, eloUpdate, playerScore,
  isProvisional, formatRating, formatDelta, ratedStatus, reasonText, autosaveForfeitsAsLoss,
} from '../src/rating.js';
import { MemoryStorage, createStorage, STORAGE_PREFIX, SCHEMA_VERSION, MAX_RATING_HISTORY } from '../src/storage.js';
import { DIFFICULTIES } from '../src/ai.js';
import { ratingSparkline, ratingPanelHtml } from '../src/ui/rating-view.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n  ${e.message}`); }
}
const KEY = `${STORAGE_PREFIX}player-rating`;

// ─── Elo math ────────────────────────────────────────────────────
test('expected score is 0.5 for equal ratings and symmetric', () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
  const a = expectedScore(1200, 1600), b = expectedScore(1600, 1200);
  assert.ok(Math.abs(a + b - 1) < 1e-12);
  assert.ok(Math.abs(a - 1 / 11) < 1e-12, 'a 400-point gap gives 1/11');
});
test('K is 40 for the first 20 rated games and 20 afterwards', () => {
  assert.equal(kFactor(0), 40);
  assert.equal(kFactor(19), 40);
  assert.equal(kFactor(20), 20);
  assert.equal(kFactor(250), 20);
});
test('a win against an equal opponent with K=40 gains 20', () => {
  assert.deepEqual(eloUpdate(1200, 1200, 1, 0).delta, 20);
  assert.deepEqual(eloUpdate(1200, 1200, 0, 0).delta, -20);
  assert.deepEqual(eloUpdate(1200, 1200, 0.5, 0).delta, 0);
  assert.deepEqual(eloUpdate(1200, 1200, 1, 20).delta, 10);
});
test('known values against the bot levels', () => {
  // 1200 vs 1300 (Club Player): expected 0.35993; win +25.6 -> 1226, loss -14.4 -> 1186, draw +5.6 -> 1206
  assert.equal(eloUpdate(1200, 1300, 1, 0).after, 1226);
  assert.equal(eloUpdate(1200, 1300, 0, 0).after, 1186);
  assert.equal(eloUpdate(1200, 1300, 0.5, 0).after, 1206);
  // 1200 vs 1000 with K=20: expected 0.75975; loss -15.2 -> 1185
  assert.equal(eloUpdate(1200, 1000, 0, 25).after, 1185);
  // 1200 vs 2500 (Grandmaster): a win gains nearly the full K
  assert.equal(eloUpdate(1200, 2500, 1, 0).after, 1240);
});
test('invalid scores and ratings are rejected', () => {
  assert.throws(() => eloUpdate(1200, 1200, 0.7, 0));
  assert.throws(() => eloUpdate(1200, NaN, 1, 0));
});
test('player score follows the player colour; resignation is a loss', () => {
  assert.equal(playerScore('1-0', 'w'), 1);
  assert.equal(playerScore('0-1', 'w'), 0);
  assert.equal(playerScore('0-1', 'b'), 1);
  assert.equal(playerScore('1-0', 'b'), 0);
  assert.equal(playerScore('1/2-1/2', 'b'), 0.5);
  assert.throws(() => playerScore('*', 'w'));
});
test('provisional formatting until 10 games', () => {
  assert.equal(PROVISIONAL_GAMES, 10);
  assert.equal(formatRating(1236, 3), '1236?');
  assert.equal(formatRating(1236, 9), '1236?');
  assert.equal(formatRating(1236, 10), '1236');
  assert.ok(isProvisional(0) && !isProvisional(10));
  assert.equal(formatDelta(36), '+36');
  assert.equal(formatDelta(-12), '\u221212');
  assert.equal(formatDelta(0), '\u00b10');
});
test('every bot level has a numeric nominal rating', () => {
  assert.deepEqual(DIFFICULTIES.slice(0, 8).map((d) => d.elo), [400, 700, 1000, 1300, 1600, 1900, 2200, 2500]);
});

// ─── Rated / unrated rules ───────────────────────────────────────
const base = { mode: 'bot', rated: true, usedUndo: false, usedHint: false, loaded: false, legacy: false, botElo: 1300 };
test('a game against the bot is never rated', () => {
  assert.equal(ratedStatus(base).rated, false);
  assert.equal(ratedStatus(base).code, 'bot');
  assert.equal(ratedStatus(base, { reason: 'checkmate', plies: 30 }).code, 'bot');
  assert.equal(ratedStatus({ ...base, rated: false }).code, 'bot');
  assert.equal(ratedStatus({ ...base, usedUndo: true }).code, 'bot');
  assert.equal(ratedStatus({ ...base, usedHint: true }).code, 'bot');
  assert.equal(ratedStatus(base, { reason: 'resignation', plies: 0 }).code, 'bot');
  assert.equal(ratedStatus(base, { reason: 'resignation', plies: 20 }).code, 'bot');
  assert.match(ratedStatus(base).text, /bullet, blitz and rapid/);
});
test('two-player and analysis games are never rated', () => {
  assert.equal(ratedStatus({ ...base, mode: 'local' }).code, 'local');
  assert.equal(ratedStatus({ ...base, mode: 'analysis' }).code, 'analysis');
  assert.equal(ratedStatus({ ...base, mode: 'puzzle' }).rated, false);
});
test('every unrated reason is a complete sentence', () => {
  for (const code of ['bot', 'local', 'analysis', 'off', 'undo', 'hint', 'loaded', 'legacy', 'short', 'nolevel']) {
    assert.match(reasonText(code), /^[A-Z].+\.$/, code);
  }
  assert.match(ratedStatus({ mode: 'local' }).text, /^[A-Z].+\.$/);
});

test('a bot autosave never counts as a rated loss', () => {
  const auto = (n, rating = { rated: true }) => ({ mode: 'bot', botLevel: 'lvl4', playerColor: 'w', game: { version: 1, startFen: 'x', uci: Array(n).fill('e2e4'), resultInfo: null }, rating });
  assert.equal(autosaveForfeitsAsLoss(auto(7), 1300), false);
  assert.equal(autosaveForfeitsAsLoss(auto(8), 1300), false);
  assert.equal(autosaveForfeitsAsLoss(auto(20), 1300), false);
  assert.equal(autosaveForfeitsAsLoss({ ...auto(20), mode: 'local' }, 1300), false);
  assert.equal(autosaveForfeitsAsLoss(null, 1300), false);
});

// ─── Persistence ─────────────────────────────────────────────────
test('a fresh store starts at 1200 with no games', () => {
  const s = createStorage({ backend: new MemoryStorage() });
  const r = s.getPlayerRating();
  assert.equal(r.rating, START_RATING);
  assert.equal(r.games, 0);
  assert.equal(r.peak, START_RATING);
  assert.deepEqual(r.history, []);
  assert.equal(r.provisional, true);
});
test('recording games updates rating, record, peak and history, and persists', () => {
  const backend = new MemoryStorage();
  const s = createStorage({ backend });
  const u1 = s.recordRatedGame({ botLevel: 'lvl4', opponent: 1300, score: 1, at: 1 });
  assert.deepEqual([u1.before, u1.after, u1.delta, u1.k, u1.games], [1200, 1226, 26, 40, 1]);
  const u2 = s.recordRatedGame({ botLevel: 'lvl4', opponent: 1300, score: 0, at: 2 });
  assert.equal(u2.before, 1226);
  s.recordRatedGame({ botLevel: 'lvl3', opponent: 1000, score: 0.5, at: 3 });
  const stored = JSON.parse(backend.getItem(KEY));
  assert.equal(stored.version, SCHEMA_VERSION);
  assert.equal(stored.games, 3);
  assert.deepEqual([stored.wins, stored.draws, stored.losses], [1, 1, 1]);
  assert.equal(stored.peak, 1226);
  assert.equal(stored.history.length, 3);
  assert.deepEqual(stored.history[0], { at: 1, rating: 1226, delta: 26, opponent: 1300, botLevel: 'lvl4', score: 1 });
  assert.equal(stored.provisional, undefined, 'the derived flag is not stored');
  // A new instance over the same backend reads the same data.
  const again = createStorage({ backend }).getPlayerRating();
  assert.equal(again.rating, stored.rating);
  assert.equal(again.games, 3);
});
test('K drops to 20 from the 21st rated game and provisional ends at 10', () => {
  const s = createStorage({ backend: new MemoryStorage() });
  let last;
  for (let i = 0; i < 21; i++) {
    last = s.recordRatedGame({ botLevel: 'lvl4', opponent: 1300, score: i % 2 ? 0 : 1 });
    if (i === 8) assert.equal(last.provisional, true);
    if (i === 9) assert.equal(last.provisional, false);
    if (i < 20) assert.equal(last.k, 40);
  }
  assert.equal(last.k, 20);
});
test('history is capped and corrupt data falls back to defaults', () => {
  const backend = new MemoryStorage();
  backend.setItem(KEY, JSON.stringify({ version: 1, rating: 1400, games: 600, wins: 600, draws: 0, losses: 0, peak: 1500, history: Array.from({ length: MAX_RATING_HISTORY }, (_, i) => ({ at: i, rating: 1400 })) }));
  const s = createStorage({ backend });
  s.recordRatedGame({ botLevel: 'lvl5', opponent: 1600, score: 1 });
  const r = s.getPlayerRating();
  assert.equal(r.history.length, MAX_RATING_HISTORY);
  assert.equal(r.history[0].at, 1);
  backend.setItem(KEY, '{not json');
  assert.equal(createStorage({ backend }).getPlayerRating().rating, START_RATING);
  backend.setItem(KEY, JSON.stringify({ rating: 'x', history: 'y' }));
  const fixed = createStorage({ backend }).getPlayerRating();
  assert.equal(fixed.rating, START_RATING);
  assert.deepEqual(fixed.history, []);
});
test('reset removes the rating and leaves other data alone', () => {
  const backend = new MemoryStorage();
  const s = createStorage({ backend });
  s.recordRatedGame({ botLevel: 'lvl4', opponent: 1300, score: 1 });
  s.recordResult({ mode: 'bot', botLevel: 'lvl4', playerColor: 'w', result: '1-0' });
  const r = s.resetPlayerRating();
  assert.equal(r.rating, START_RATING);
  assert.equal(r.games, 0);
  assert.equal(backend.getItem(KEY), null);
  assert.equal(s.getStats().totals.games, 1);
});
test('invalid opponents and scores are rejected without writing', () => {
  const backend = new MemoryStorage();
  const s = createStorage({ backend });
  assert.throws(() => s.recordRatedGame({ opponent: undefined, score: 1 }));
  assert.throws(() => s.recordRatedGame({ opponent: 1300, score: 2 }));
  assert.equal(backend.getItem(KEY), null);
});
test('the autosave keeps the rating state of a game in progress', () => {
  const s = createStorage({ backend: new MemoryStorage() });
  s.saveAutosave({ name: 'A', mode: 'bot', botLevel: 'lvl4', playerColor: 'w', game: { version: 1, startFen: 'x', uci: [] }, rating: { rated: true, usedUndo: true, usedHint: false } });
  assert.deepEqual(s.loadAutosave().rating, { rated: true, usedUndo: true, usedHint: false });
  s.saveAutosave({ name: 'B', mode: 'bot', game: { version: 1, startFen: 'x', uci: [] } });
  assert.equal(s.loadAutosave().rating, null);
});


test('ratingSparkline accepts a missing or invalid history without throwing', () => {
  assert.equal(ratingSparkline(null), '');
  assert.equal(ratingSparkline(undefined), '');
  assert.equal(ratingSparkline({ rating: 1300 }), '');
  assert.equal(ratingSparkline([null, { rating: 'nope' }, 12]), '');
  const svg = ratingSparkline([{ rating: 1236 }, { rating: 1284 }]);
  assert.match(svg, /rating-spark/);
  const html = ratingPanelHtml(null);
  assert.match(html, /Your online ratings/);
  assert.match(html, /Bullet/);
  assert.match(html, /Blitz/);
  assert.match(html, /Rapid/);
  assert.match(html, /1500\?/);
  assert.doesNotMatch(html, /Your rating against the bot/);
});

console.log(`\nRating tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
