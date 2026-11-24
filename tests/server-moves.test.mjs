// Move and clock checks. Run: node tests/server-moves.test.mjs
import assert from 'node:assert/strict';
import { START_FEN, Game } from '../src/engine.js';
import { applyUci, clockAfterMove } from '../server/moves.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.stack || err)); }
}

const start = () => new Game(START_FEN).toJSON();

test('an illegal move is rejected and the game is unchanged', () => {
  const before = start();
  const out = applyUci(before, 'e2e5');
  assert.equal(out.ok, false);
  assert.match(out.error, /not legal/);
  assert.deepEqual(before.uci, []);
});

test('fool\'s mate is reported as checkmate and then the game is closed', () => {
  let game = start();
  for (const uci of ['f2f3', 'e7e5', 'g2g4']) {
    const step = applyUci(game, uci);
    assert.equal(step.ok, true, step.error);
    assert.equal(step.result, null);
    game = step.game;
  }
  const mate = applyUci(game, 'd8h4');
  assert.equal(mate.ok, true);
  assert.equal(mate.result.result, '0-1');
  assert.equal(mate.result.reason, 'checkmate');
  const after = applyUci(mate.game, 'e2e4');
  assert.equal(after.ok, false);
  assert.match(after.error, /already over/);
});

test('returning to the start position three times is a draw', () => {
  let game = start();
  const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
  let last = null;
  for (const uci of moves) {
    last = applyUci(game, uci);
    assert.equal(last.ok, true, last.error);
    game = last.game;
  }
  assert.equal(last.result.reason, 'threefold');
  assert.equal(last.result.result, '1/2-1/2');
});

test('a Fischer increment is added only when the mover still has time', () => {
  const kept = clockAfterMove({ wMs: 60_000, bMs: 60_000, incMs: 2_000, turn: 'w', elapsedMs: 1_000 });
  assert.equal(kept.wMs, 61_000);
  assert.equal(kept.bMs, 60_000);
  assert.equal(kept.flagged, null);
  const flagged = clockAfterMove({ wMs: 1_000, bMs: 60_000, incMs: 2_000, turn: 'w', elapsedMs: 1_000 });
  assert.equal(flagged.wMs, 0);
  assert.equal(flagged.flagged, 'w');
  assert.throws(() => clockAfterMove({ wMs: 1_000, bMs: 1_000, incMs: 0, turn: 'w', elapsedMs: -1 }));
});

console.log(`\nServer move tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
