// Glicko-2 against Mark Glickman's published example, plus the three paces.
// Run: node tests/glicko.test.mjs
import assert from 'node:assert/strict';
import {
  GLICKO_START_DEVIATION, GLICKO_START_RATING, GLICKO_START_VOLATILITY, GLICKO_TAU,
  formatGlicko, glickoPeriod, isProvisionalDeviation,
} from '../src/glicko.js';
import { applyPaceGame, blankOnlineRatings, normalizeOnlineRatings } from '../src/online-ratings.js';
import { paceForClock, rateGame, readRatings } from '../server/ratings.mjs';
import { openDatabase } from '../server/db.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n  ${e.stack || e.message}`); }
}

const near = (actual, expected, tol, label) => {
  assert.ok(Math.abs(actual - expected) < tol, `${label}: ${actual} is not within ${tol} of ${expected}`);
};

test('the published example updates rating, deviation and volatility', () => {
  const next = glickoPeriod(
    { rating: 1500, deviation: 200, volatility: 0.06 },
    [
      { rating: 1400, deviation: 30, score: 1 },
      { rating: 1550, deviation: 100, score: 0 },
      { rating: 1700, deviation: 300, score: 0 },
    ],
    GLICKO_TAU,
  );
  near(next.rating, 1464.06, 0.05, 'rating');
  near(next.deviation, 151.52, 0.05, 'deviation');
  near(next.volatility, 0.05999, 0.00002, 'volatility');
});

test('a win raises the winner and a loss lowers the other player from the same starting numbers', () => {
  const start = { rating: GLICKO_START_RATING, deviation: GLICKO_START_DEVIATION, volatility: GLICKO_START_VOLATILITY };
  const winner = glickoPeriod(start, [{ rating: start.rating, deviation: start.deviation, score: 1 }]);
  const loser = glickoPeriod(start, [{ rating: start.rating, deviation: start.deviation, score: 0 }]);
  assert.ok(winner.rating > 1500, winner.rating);
  assert.ok(loser.rating < 1500, loser.rating);
  assert.ok(winner.deviation < 350 && loser.deviation < 350);
  const idle = glickoPeriod(start, []);
  assert.ok(idle.deviation > 350);
  assert.equal(idle.rating, 1500);
});

test('a question mark is shown while the deviation is above 110', () => {
  assert.equal(formatGlicko(1500.4, 350), '1500?');
  assert.equal(formatGlicko(1464.06, 151.52), '1464?');
  assert.equal(formatGlicko(1464.06, 110), '1464');
  assert.equal(isProvisionalDeviation(110.01), true);
  assert.equal(isProvisionalDeviation(110), false);
});

test('a pace record stores the result, the colour and the chart point', () => {
  const blank = blankOnlineRatings().blitz;
  const next = { rating: 1604.2, deviation: 290.4, volatility: 0.06 };
  const updated = applyPaceGame(blank, {
    next, score: 1, color: 'w', opponent: { rating: 1500 }, opponentName: 'Bea', at: 10,
  });
  assert.equal(updated.games, 1);
  assert.equal(updated.wins, 1);
  assert.equal(updated.white.wins, 1);
  assert.equal(updated.black.games, 0);
  assert.equal(updated.history.length, 1);
  assert.equal(updated.history[0].delta, 104);
  assert.equal(updated.peak, null);
  assert.equal(updated.provisional, true);
  assert.equal(normalizeOnlineRatings(null).rapid.peak, null);
  assert.equal(normalizeOnlineRatings(null).rapid.rating, 1500);
});

test('the peak ignores provisional ratings and stays empty until the rating is stable', () => {
  const game = (pace, rating, deviation, at) => applyPaceGame(pace, {
    next: { rating, deviation, volatility: 0.06 },
    score: 1, color: 'w', opponent: { rating: 1500 }, opponentName: 'Bea', at,
  });
  const blank = blankOnlineRatings().blitz;
  assert.equal(blank.peak, null);
  const provisional = game(blank, 1700, 200, 10);
  assert.equal(provisional.peak, null);
  const stable = game(provisional, 1620, 100, 20);
  assert.equal(stable.peak, 1620);
  const stillProvisional = game(stable, 1900, 130, 30);
  assert.equal(stillProvisional.peak, 1620);
  const lower = game(normalizeOnlineRatings({ blitz: stillProvisional }).blitz, 1580, 90, 40);
  assert.equal(lower.peak, 1620);
  const higher = game(lower, 1710, 80, 50);
  assert.equal(higher.peak, 1710);
});

test('the server scores both players from the ratings they had before the game', () => {
  const db = openDatabase(':memory:');
  const first = rateGame(db, {
    pace: 'blitz', whiteId: 'Ada', blackId: 'Bea', result: '1-0', now: 10, whiteName: 'Ada', blackName: 'Bea',
  });
  assert.ok(first.Ada.delta > 0 && first.Bea.delta < 0);
  assert.equal(first.Ada.before, 1500);
  assert.equal(first.Bea.before, 1500);
  assert.equal(first.Ada.document.blitz.games, 1);
  assert.equal(first.Ada.document.blitz.peak, null);
  assert.equal(first.Ada.provisional, true);
  assert.equal(first.Ada.document.bullet.games, 0);
  assert.equal(first.Bea.document.rapid.games, 0);
  const again = rateGame(db, {
    pace: 'bullet', whiteId: 'Ada', blackId: 'Bea', result: '1/2-1/2', now: 20, whiteName: 'Ada', blackName: 'Bea',
  });
  assert.equal(again.Ada.pace, 'bullet');
  assert.equal(readRatings(db, 'Ada').blitz.games, 1);
  assert.equal(readRatings(db, 'Ada').bullet.games, 1);
  assert.equal(readRatings(db, 'Ada').blitz.rating, first.Ada.after);
  assert.equal(paceForClock(180000, 2000), 'blitz');
  assert.equal(paceForClock(60000, 0), 'bullet');
  assert.equal(paceForClock(600000, 5000), 'rapid');
  assert.equal(paceForClock(0, 0), null);
  assert.equal(rateGame(db, { pace: 'rapid', whiteId: 'Ada', blackId: 'Bea', result: 'other', now: 30 }), null);
  db.close();
});

console.log(`\nGlicko tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
