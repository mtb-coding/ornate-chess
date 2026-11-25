// Position editor rules. Run: node tests/setup-position.test.mjs
import assert from 'node:assert/strict';
import { Position, START_FEN } from '../src/engine.js';
import {
  castleAvailable,
  emptySetup,
  epCandidates,
  epSquares,
  moveSetupPiece,
  placePiece,
  setSetupCastle,
  setSetupEp,
  setSetupSide,
  setupFen,
  setupFromFen,
  setupProblems,
  startSetup,
} from '../src/setup-position.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.stack || err)); }
}

test('the starting setup is the normal opening position', () => {
  const state = startSetup();
  assert.equal(setupFen(state), START_FEN);
  assert.deepEqual(setupProblems(state), []);
  assert.equal(state.castle.wK && state.castle.wQ && state.castle.bK && state.castle.bQ, true);
});

test('moving a king clears castling and putting it back does not tick the box again', () => {
  let state = moveSetupPiece(startSetup(), 4, 12);
  assert.equal(state.castle.wK, false);
  assert.equal(state.castle.wQ, false);
  assert.equal(castleAvailable(state.squares, 'wK'), false);
  state = moveSetupPiece(state, 12, 4);
  assert.equal(castleAvailable(state.squares, 'wK'), true);
  assert.equal(state.castle.wK, false);
  assert.equal(setSetupCastle(state, 'wK', true).castle.wK, true);
});

test('moving one rook clears only that side of castling', () => {
  const state = moveSetupPiece(startSetup(), 7, 15);
  assert.equal(state.castle.wK, false);
  assert.equal(state.castle.wQ, true);
  assert.equal(state.castle.bK, true);
});

test('an en passant square stays set when the side to move changes', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  let state = setupFromFen(fen);
  assert.equal(state.ep, 20);
  assert.deepEqual(epSquares(state), [20]);
  state = setSetupSide(state, 'w');
  assert.equal(state.side, 'w');
  assert.equal(state.ep, 20);
  assert.deepEqual(epSquares(state), []);
  assert.equal(setupFen(state).split(' ')[3], '-');
  state = setSetupSide(state, 'b');
  assert.equal(state.ep, 20);
  assert.equal(setupFen(state).split(' ')[3], 'e3');
  state = moveSetupPiece(state, 28, 36);
  assert.equal(state.ep, null);
});

test('a two-square pawn move sets en passant and leaves the side to move unchanged', () => {
  const stillWhite = moveSetupPiece(startSetup(), 12, 28);
  assert.equal(stillWhite.side, 'w');
  assert.equal(stillWhite.ep, 20);
  assert.equal(setupFen(stillWhite).split(' ')[3], '-');
  const later = setSetupSide(stillWhite, 'b');
  assert.equal(later.side, 'b');
  assert.equal(later.ep, 20);
  assert.equal(setupFen(later), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  const black = moveSetupPiece(startSetup(), 52, 36);
  assert.equal(black.side, 'w');
  assert.equal(black.ep, 44);
  assert.equal(setupFen(black).split(' ')[3], 'e6');
  const oneStep = moveSetupPiece(setSetupSide(startSetup(), 'b'), 12, 20);
  assert.equal(oneStep.ep, null);
  assert.equal(oneStep.side, 'b');
});

test('choosing an en passant square does not change the side to move', () => {
  let state = moveSetupPiece(startSetup(), 12, 28);
  state = setSetupEp(state, null);
  assert.equal(state.side, 'w');
  assert.equal(state.ep, null);
  state = setSetupEp(state, 20);
  assert.equal(state.side, 'w');
  assert.equal(state.ep, 20);
  assert.equal(setupFen(state).split(' ')[3], '-');
  state = setSetupSide(state, 'b');
  assert.equal(state.side, 'b');
  assert.equal(state.ep, 20);
  assert.equal(setupFen(state).split(' ')[3], 'e3');
});

test('en passant is refused while the square the pawn left is occupied', () => {
  const state = placePiece(startSetup(), 28, { color: 'w', type: 'p' });
  assert.equal(epCandidates(state).some((c) => c.sq === 20), false);
  assert.equal(setSetupEp(state, 20).ep, null);
});

test('the en passant capture is legal in the position the editor produces', () => {
  let state = moveSetupPiece(startSetup(), 12, 28);
  state = placePiece(state, 27, { color: 'b', type: 'p' });
  assert.equal(state.side, 'w');
  assert.equal(state.ep, 20);
  state = setSetupSide(state, 'b');
  const pos = Position.fromFen(setupFen(state));
  assert.equal(pos.epSquare, 20);
  assert.equal(pos.isLegal('d4e3'), true);
  const after = pos.makeMove('d4e3');
  assert.equal(after.pieceAt(20).color, 'b');
  assert.equal(after.pieceAt(20).type, 'p');
  assert.equal(after.pieceAt(28), null);
  assert.equal(after.pieceAt(27), null);
});

test('a pawn on the last rank, a missing king, and a king in check are refused', () => {
  let state = emptySetup();
  state = placePiece(state, 4, { color: 'w', type: 'k' });
  state = placePiece(state, 60, { color: 'b', type: 'k' });
  assert.deepEqual(setupProblems(state), []);
  assert.equal(Position.fromFen(setupFen(state)).toFen(), setupFen(state));
  assert.match(setupProblems(placePiece(state, 56, { color: 'w', type: 'p' }))[0], /first or last rank/);
  assert.match(setupProblems(placePiece(state, 60, null))[0], /exactly one king/);
  const adjacent = placePiece(placePiece(emptySetup(), 4, { color: 'w', type: 'k' }), 12, { color: 'b', type: 'k' });
  assert.match(setupProblems(adjacent)[0], /not to move is in check/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
