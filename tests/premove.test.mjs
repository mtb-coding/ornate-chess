// Premove preview rules. Run: node tests/premove.test.mjs
import assert from 'node:assert/strict';
import { Game, Position } from '../src/engine.js';
import { Clock } from '../src/ui/clock.js';
import {
  PREMOVE_LIMIT,
  applyPremoveBoard,
  pieceBoard,
  premoveAllowed,
  premoveDestinations,
  previewPremoves,
} from '../src/premove.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.stack || err)); }
}

test('a knight can premove to any jump, including onto a friendly piece', () => {
  const board = pieceBoard(new Game().position);
  const dests = premoveDestinations(board, 'w', 6); // g1
  assert.ok(dests.includes(21)); // f3
  assert.ok(dests.includes(23)); // h3
  assert.equal(dests.length, 3); // f3, h3, e2 is empty; g1 knight reaches f3, h3, e2
});

test('a rook stops on the first piece, so a recapture of that piece can be queued', () => {
  const board = pieceBoard(new Game().position);
  const dests = premoveDestinations(board, 'w', 0); // a1
  assert.deepEqual(dests, [1, 8]); // b1 knight and a2 pawn
  assert.equal(applyPremoveBoard(board, 'w', 'a1a2'), true);
  assert.equal(board[0], null);
  assert.equal(board[8].type, 'r');
});

test('a pawn can premove a diagonal capture onto an empty square', () => {
  const game = new Game();
  game.playUci('e2e4');
  const board = pieceBoard(game.position);
  const dests = premoveDestinations(board, 'b', 52); // e7
  assert.ok(dests.includes(36)); // e5
  assert.ok(dests.includes(44)); // e6
  assert.ok(dests.includes(43)); // d6
  assert.ok(dests.includes(45)); // f6
  assert.equal(premoveAllowed(game.position, 'b', [], 'd7e6'), true);
  assert.equal(premoveAllowed(game.position, 'b', [], 'd7e6q'), false);
});

test('queued premoves are shown in order and the sixth is refused', () => {
  const game = new Game();
  game.playUci('e2e4');
  const line = ['g1f3', 'f3g5', 'g5f7', 'f7d6', 'd6b5'];
  let prior = [];
  for (const uci of line) {
    assert.equal(premoveAllowed(game.position, 'w', prior, uci), true);
    prior = prior.concat(uci);
  }
  assert.equal(prior.length, PREMOVE_LIMIT);
  assert.equal(premoveAllowed(game.position, 'w', prior, 'b5c3'), false);
  const preview = previewPremoves(game.position, 'w', prior);
  assert.equal(preview.board[6], null);
  assert.equal(preview.board[33].type, 'n'); // b5
  assert.equal(preview.marks.length, 10);
});

test('a promotion premove needs a piece and castling moves the rook on the preview', () => {
  const pos = Position.fromFen('4k3/4P3/8/8/8/8/8/4K3 b - - 0 1');
  assert.equal(premoveAllowed(pos, 'w', [], 'e7e8'), false);
  assert.equal(premoveAllowed(pos, 'w', [], 'e7e8q'), true);
  const board = pieceBoard(pos);
  assert.equal(applyPremoveBoard(board, 'w', 'e7e8q'), true);
  assert.equal(board[60].type, 'q');
  const home = pieceBoard(new Game().position);
  assert.equal(applyPremoveBoard(home, 'w', 'e1g1'), true);
  assert.equal(home[6].type, 'k');
  assert.equal(home[5].type, 'r');
  assert.equal(home[7], null);
});

test('the chess clock charges 0.1 seconds for a premove and keeps the turn when less remains', () => {
  const clock = new Clock({ wMs: 60000, bMs: 60000, incMs: 2000, onTick() {}, onFlag() {} });
  clock.start('w');
  const before = clock.now('w');
  assert.equal(clock.premove('w'), true);
  const charged = clock.now('w');
  assert.ok(Math.abs(charged - (before - 100 + 2000)) < 50, `charged ${charged}, before ${before}`);
  assert.equal(clock.running, 'b');
  clock.stop();

  const short = new Clock({ wMs: 80, bMs: 60000, incMs: 0, onTick() {}, onFlag() {} });
  short.start('w');
  assert.equal(short.premove('w'), false);
  assert.equal(short.running, 'w');
  assert.ok(short.now('w') <= 80);
  short.stop();
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
