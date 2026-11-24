// Endgame catalog and session tests.
// Run: node tests/endgames.test.mjs
import assert from 'node:assert/strict';
import { Position, Game } from '../src/engine.js';
import { ENDGAMES, ENDGAME_CATEGORIES, endgameById, validateEndgame, ideaLine, evaluatePosition, EndgameSession, reasonText, isPlayerPromotion, promotedPieceIsSafe, promotionMaterialIsWinning, holdMaterialIntact, applyEngineEval, revertUnconfirmedEval, isKingAndPawnOrBareKings, EVAL_WIN_CP, EVAL_LOST_CP } from '../src/endgames.js';
import { createNodeEngine } from './node-stockfish.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`FAIL  ${name}\n  ${e.message}`); }
}

test('the catalog has at least 14 positions', () => {
  assert.ok(ENDGAMES.length >= 14, `expected at least 14, got ${ENDGAMES.length}`);
});

test('every endgame id is unique and retrievable', () => {
  const ids = ENDGAMES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(endgameById(id).id, id);
  assert.equal(endgameById('no-such-endgame'), null);
});

test('every category used by a position is defined', () => {
  const cats = new Set(ENDGAME_CATEGORIES.map((c) => c.id));
  assert.ok(cats.size >= 4);
  for (const e of ENDGAMES) assert.ok(cats.has(e.category), e.id);
});

for (const e of ENDGAMES) {
  test(`FEN is legal: ${e.id}`, () => {
    const pos = validateEndgame(e);
    assert.ok(pos instanceof Position);
    // fromFen already requires one king each and that the side not to move is not in check.
    const fen = pos.toFen();
    assert.equal(Position.fromFen(fen).toFen(), fen);
    assert.ok(pos.legalMoves().length > 0 || pos.isCheckmate() || pos.isStalemate());
  });

  test(`the stated result matches the goal: ${e.id}`, () => {
    assert.ok(e.theory && (e.theory.result === 'win' || e.theory.result === 'draw'), e.id);
    assert.equal(e.theory.result, e.goal, e.id);
    if (e.goal === 'win') assert.ok(e.success.type === 'mate' || e.success.type === 'promote', e.id);
    if (e.goal === 'draw') {
      assert.equal(e.success.type, 'draw');
      assert.ok(e.success.holdPlies >= 1, e.id);
    }
  });

  test(`the idea line is legal: ${e.id}`, () => {
    const line = ideaLine(e);
    assert.ok(line.length >= 1, e.id);
    const pos = Position.fromFen(e.fen);
    const first = pos.parseUci(e.ideaMoves[0]);
    assert.ok(first, e.id);
    assert.equal(first.from, line[0].from);
    assert.equal(first.to, line[0].to);
  });

  test(`the explanation is written in complete sentences: ${e.id}`, () => {
    for (const text of [e.goalText, e.explanation, e.idea]) {
      assert.ok(typeof text === 'string' && text.length > 8, e.id);
      assert.match(text.trim(), /[.!?]$/, `${e.id}: ${text}`);
    }
  });
}

test('EndgameSession rejects an illegal move and accepts the idea move', () => {
  const entry = endgameById('opposition');
  const s = new EndgameSession(entry);
  assert.equal(s.playerToMove, true);
  assert.equal(s.play('a2a3').ok, false);
  const idea = entry.ideaMoves[0];
  const r = s.play(idea);
  assert.equal(r.ok, true);
  assert.equal(s.status, 'in-progress');
  assert.equal(s.engineToMove(), true);
});

test('a mate success condition is detected', () => {
  const entry = {
    id: 'mate-in-one',
    title: 'Mate in one.',
    fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
    playerColor: 'w',
    goal: 'win',
    success: { type: 'mate' },
    ideaMoves: ['f7f8'],
    explanation: 'White mates at once.',
    idea: 'Play Qf8.',
    theory: { result: 'win' },
  };
  const s = new EndgameSession(entry);
  const r = s.play('f7f8');
  assert.equal(r.ok, true);
  assert.equal(s.status, 'success');
  assert.equal(s.reason, 'checkmate');
  assert.match(reasonText(s.reason, { goal: 'win', status: 'success' }), /Checkmate/);
});

test('a promotion success condition is detected', () => {
  const entry = {
    id: 'promote-now',
    title: 'Promote the pawn.',
    fen: '8/P7/8/8/8/8/8/K6k w - - 0 1',
    playerColor: 'w',
    goal: 'win',
    success: { type: 'promote' },
    ideaMoves: ['a7a8q'],
    explanation: 'The pawn is on the seventh rank.',
    idea: 'Promote on a8.',
    theory: { result: 'win' },
  };
  const s = new EndgameSession(entry);
  const r = s.play('a7a8q');
  assert.equal(r.ok, true);
  assert.equal(s.status, 'success');
  assert.equal(s.reason, 'promotion');
});

test('stalemate is a failure in a winning position', () => {
  // King in the corner, queen on c7 would stalemate? 7k/5Q2/6K1 is mate in 1 with Qf8,
  // stalemate is Qg7? Wait Kh8, Qf7, Kg6: Qg8 or Qg7 is stalemate? Qg7 is adjacent to king - illegal.
  // Classic: Ka8, pawn a7, queen coming... simpler: use evaluatePosition on a game that is already stalemated.
  const entry = {
    id: 'stale-win',
    title: 'A win that can be stalemated.',
    fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
    playerColor: 'w',
    goal: 'win',
    success: { type: 'mate' },
    ideaMoves: ['f7f8'],
    explanation: 'Mate or stalemate is close.',
    idea: 'Mate with Qf8.',
    theory: { result: 'win' },
  };
  const s = new EndgameSession(entry);
  // Qg8? Kh8, Qf7, Kg6: Qg8 is protected? King on g6 covers g7,g5,f5,f6,f7,h5,h6,h7. Qg8 is not covered by white king (g7,h7,h8). Black has no moves if queen on g8? Qg8 checks? No, Q on g8 next to king h8 is adjacent - illegal if unprotected... Qg8 from f7 is f7g8. Is g8 attacked by black? No black pieces except king. White king g6 does not attack g8 (two squares up). So Qg8 is illegal (adjacent to king).
  // 1.Qf6+ Kg8 2.Qe7? Let's use a known stalemate: Kh8, Kg6, Qf6 is already almost... 
  // FEN k7/8/1QK5/8/8/8/8/8 w, 1.Qc7 or Qb7 is stalemate? Ka8, Qb6, Kc6: Qc7 is mate, Qb7 stalemate?
  // Ka8, Qb6, Kc6: squares a7,b7,b8: a7 attacked by king and queen, b8 by queen, b7 by king and queen. If White plays Qb7, king is not in check (queen adjacent? b7 and a8 are a knight hop? files a-b, ranks 8-7, adjacent diagonally). Qb7 checks on the diagonal? a8-b7 is diagonal, so it checks, and it's mate or the king can take if unprotected. Kc6 protects b7. Mate.
  // Classic stalemate: Ka8, Qa6, Kc6, 1.Qa7 is stalemate (queen on a7, not checking? a7 is adjacent to a8, protected by king c6? c6 doesn't protect a7. King c6 attacks b5,b6,b7,c5,c7,d5,d6,d7. Not a7.
  // Ka8, Qc6, Kc5: 1.Qc7? 
  // I'll construct with Game and evaluatePosition.
  const g = new Game('k7/8/1QK5/8/8/8/8/8 w - - 0 1');
  // Try queen to a7? Qb6 to a7: Qa7 adjacent to Ka8, protected by Kc6? no. Illegal.
  // Qb6 to b7: Qb7 checks (adjacent? a8-b7 diagonal yes), protected by Kc6, mate.
  // Qb6 to a6: Qa6, does it check? Same file as king with nothing between? a6-a8, a7 empty, check on the file. King has no squares... a7 covered by queen, b7/b8 by king and queen. That's mate? Ka8 in check from Qa6, cannot go to a7 (queen), b8 (queen? Qa6 doesn't attack b8; Kc6 attacks b7,b5,c5,c7,d5,d6,d7,b6 occupied. Kc6 attacks b7 not b8. Queen a6 attacks a-file and rank 6 and diagonals b5,c4 and b7,c8. So b8 is not attacked, b7 is. King can go to b8? Kc6 does not attack b8. So Ka8 to b8 is legal if not in check from Qa6. Qa6 does not attack b8. Not mate.
  // The famous: White Kc6, Qb6, Black Ka8, 1.Qb7# or 1.Qc7 stalemate? Qc7: does it check Ka8? Queen c7 to a8 is a diagonal with b7 empty. Yes check? c7-b8-a8? That's not a straight diagonal. c7 to a8 is left 2, up 1 - not a queen move line. Qc7 attacks a7, b7, b8, c8, etc. a8? no. If not in check and Black has no moves: a7 attacked by Q and K, b7 by Q and K, b8 by Q. Yes stalemate!
  const r = g.play(g.position.parseUci('b6c7'));
  assert.equal(r, true);
  const ev = evaluatePosition(g, entry, g.lastMove);
  assert.equal(ev.status, 'failure');
  assert.equal(ev.reason, 'stalemate');
});

test('a held draw is detected after the required number of plies when the defence is still sound', () => {
  const entry = {
    ...endgameById('vancura'),
    id: 'hold-draw',
    success: { type: 'draw', holdPlies: 2 },
  };
  const s = new EndgameSession(entry);
  assert.equal(s.play('f6f5').ok, true);
  assert.equal(s.status, 'in-progress');
  const reply = ['b5a4', 'b5b4', 'b5c4', 'b5a5', 'b5c5', 'b5c6', 'b5b6'].find((u) => s.position.parseUci(u));
  assert.ok(reply);
  const r2 = s.play(reply);
  assert.equal(r2.ok, true);
  assert.equal(s.status, 'success');
  assert.equal(s.reason, 'hold');
  assert.equal(holdMaterialIntact(s.game, entry), true);
});

test('checkmate against the player fails a draw position', () => {
  const entry = {
    id: 'drawn-but-mated',
    title: 'A failed defence.',
    fen: '7k/5R2/6K1/8/8/8/8/8 w - - 0 1',
    playerColor: 'b',
    goal: 'draw',
    success: { type: 'draw', holdPlies: 40 },
    ideaMoves: ['h8g8'],
    explanation: 'White is about to mate.',
    idea: 'There is no defence.',
    theory: { result: 'draw' },
  };
  const s = new EndgameSession(entry);
  assert.equal(s.engineToMove(), true);
  const r = s.play('f7f8');
  assert.equal(r.ok, true);
  assert.equal(s.status, 'failure');
  assert.equal(s.reason, 'checkmate');
});

test('reset restores the starting position', () => {
  const s = new EndgameSession(endgameById('square-of-pawn'));
  s.play('a5a6');
  assert.ok(s.game.moves.length === 1);
  s.reset();
  assert.equal(s.game.moves.length, 0);
  assert.equal(s.status, 'in-progress');
  assert.equal(s.position.toFen(), Position.fromFen(endgameById('square-of-pawn').fen).toFen());
});

test('the square of the pawn is completed by promotion', () => {
  const s = new EndgameSession(endgameById('square-of-pawn'));
  assert.equal(s.play('a5a6').ok, true);
  // A poor defence, walking away from the pawn, lets it through quickly.
  const replies = ['e5f5', 'e5f6', 'e5e6', 'e5d6', 'e5f4'];
  let played = false;
  for (const u of replies) {
    if (s.position.parseUci(u)) { assert.equal(s.play(u).ok, true); played = true; break; }
  }
  assert.ok(played);
  // Push the pawn and, if needed, the king, until promotion or a cap of 20 moves.
  let steps = 0;
  while (s.status === 'in-progress' && steps < 20) {
    const pos = s.position;
    const pawnMoves = pos.legalMoves().filter((m) => m.piece === 'p' && (m.promotion === 'q' || !m.promotion));
    const move = pawnMoves.sort((a, b) => (b.promotion ? 1 : 0) - (a.promotion ? 1 : 0) || b.to - a.to)[0] || pos.legalMoves()[0];
    s.play(move);
    steps += 1;
  }
  assert.equal(s.status, 'success');
  assert.ok(s.reason === 'promotion' || s.reason === 'checkmate');
});

test('the queen versus rook pawn and wrong-bishop positions start with a real choice', () => {
  for (const id of ['queen-vs-rook-pawn', 'wrong-bishop']) {
    const e = endgameById(id);
    const pos = Position.fromFen(e.fen);
    assert.ok(pos.legalMoves().length >= 2, `${id} should have more than one legal move`);
    const idea = pos.parseUci(e.ideaMoves[0]);
    assert.ok(idea, id);
    const other = pos.legalMoves().filter((m) => !(m.from === idea.from && m.to === idea.to && (m.promotion || '') === (idea.promotion || '')));
    assert.ok(other.length >= 1, id);
  }
});

test('promoting a pawn counts only when the new piece is safe and the player is winning', () => {
  const s = new EndgameSession({
    id: 'promote-now',
    title: 'Promote the pawn.',
    fen: '8/P7/8/8/8/8/8/K6k w - - 0 1',
    playerColor: 'w',
    goal: 'win',
    success: { type: 'promote' },
    ideaMoves: ['a7a8q'],
    explanation: 'The pawn is on the seventh rank.',
    idea: 'Promote on a8.',
    theory: { result: 'win' },
  });
  const r = s.play('a7a8q');
  assert.equal(r.ok, true);
  assert.equal(isPlayerPromotion(s.game, s.entry, s.game.lastMove), true);
  assert.equal(promotedPieceIsSafe(s.game, s.game.lastMove), true);
  assert.equal(promotionMaterialIsWinning(s.game, 'w'), true);
  assert.equal(s.status, 'success');
  assert.equal(s.reason, 'promotion');
});

test('a promotion that hangs the new queen is not a success (promote-hole)', () => {
  const s = new EndgameSession(endgameById('opposition'));
  const line = ['d3c4', 'd6e6', 'd2d4', 'e6f7', 'd4d5', 'f7e7', 'd5d6', 'e7e8', 'c4c5', 'e8f7', 'd6d7', 'f7e7', 'd7d8q'];
  for (const u of line) {
    const r = s.play(u);
    assert.equal(r.ok, true, u);
    assert.notEqual(s.status, 'success', `status became success after ${u}`);
  }
  assert.equal(s.status, 'in-progress');
  assert.equal(isPlayerPromotion(s.game, s.entry, s.game.lastMove), true);
  assert.equal(promotedPieceIsSafe(s.game, s.game.lastMove), false);
  const taken = s.play('e7d8');
  assert.equal(taken.ok, true);
  assert.equal(s.status, 'failure');
  assert.equal(s.reason, 'insufficient');
});

test('a promotion by the other side does not complete a promote goal', () => {
  const entry = {
    id: 'opp-promotes',
    title: 'The opponent is about to promote.',
    fen: '8/8/8/8/8/8/pK5k/8 w - - 0 1',
    playerColor: 'w',
    goal: 'win',
    success: { type: 'promote' },
    ideaMoves: ['b2c3'],
    explanation: 'White must not be given credit for Black\'s promotion.',
    idea: 'Step aside.',
    theory: { result: 'win' },
  };
  const s = new EndgameSession(entry);
  assert.equal(s.play('b2c3').ok, true);
  assert.equal(s.status, 'in-progress');
  const r = s.play('a2a1q');
  assert.equal(r.ok, true);
  assert.equal(isPlayerPromotion(s.game, entry, s.game.lastMove), false);
  assert.notEqual(s.status, 'success');
});

test('a lost Vancura defence is not held once the attacker promotes (hold-hole)', () => {
  const s = new EndgameSession(endgameById('vancura'));
  const line = [
    'f6f1', 'a8c8', 'f1b1', 'b5c6', 'b1c1', 'c6b7', 'c1b1', 'b7a8', 'b1f1', 'a6a7',
    'g7f7', 'c8c7', 'f7e6', 'a8b8', 'f1b1', 'c7b7', 'b1d1', 'b7b5', 'd1d8', 'b8b7',
    'd8d7', 'b7a6', 'd7d8', 'b5b8', 'd8d1', 'b8b6', 'e6e5', 'b6b5', 'e5d4', 'a7a8q',
  ];
  for (const u of line) {
    const r = s.play(u);
    assert.equal(r.ok, true, u);
    if (u === 'a7a8q') break;
    assert.equal(s.status, 'in-progress', u);
  }
  assert.equal(s.status, 'failure');
  assert.equal(s.reason, 'collapsed');
  assert.equal(holdMaterialIntact(s.game, endgameById('vancura')), false);
  assert.match(reasonText(s.reason, { goal: 'draw', status: 'failure' }), /material/);
});

{
  const name = 'the Vancura move 1...Rf1 is rejected once the engine evaluates it';
  const s = new EndgameSession(endgameById('vancura'));
  try {
    assert.equal(s.play('f6f1').ok, true);
    assert.equal(s.status, 'in-progress');
  } catch (e) {
    failed++; console.error(`FAIL  ${name}\n  ${e.message}`);
  }
  const engine = createNodeEngine();
  try {
    const lines = await engine.analyse(s.position.toFen(), { depth: 12, multipv: 1 });
    s.applyEval(lines);
    assert.equal(s.status, 'failure');
    assert.equal(s.reason, 'lost');
    passed++;
  } catch (e) {
    failed++; console.error(`FAIL  ${name}\n  ${e.message}`);
  } finally {
    engine.quit();
  }
}


function drawEntry(over = {}) {
  return {
    id: 'test-draw',
    title: 'Test draw',
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
    playerColor: 'b',
    goal: 'draw',
    success: { type: 'draw', holdPlies: 40 },
    goalText: 'Hold the draw.',
    ...over,
  };
}

test('the defender checkmating the attacker completes a draw position', () => {
  const entry = drawEntry({ fen: '8/8/8/8/8/k7/2q5/K7 b - - 0 1' });
  const s = new EndgameSession(entry);
  const r = s.play('c2b2');
  assert.equal(r.ok, true);
  assert.equal(s.status, 'success');
  assert.equal(s.reason, 'checkmate');
  assert.match(reasonText(s.reason, { goal: 'draw', status: 'success' }), /Checkmate/);
});

test('a rook trade into a drawn king-and-pawn ending is not marked collapsed', () => {
  const entry = drawEntry({ fen: '8/8/8/3krR2/8/3KP3/8/8 w - - 0 1', playerColor: 'b' });
  const s = new EndgameSession(entry);
  assert.equal(s.play('f5e5').ok, true);
  assert.equal(s.play('d5e5').ok, true);
  assert.equal(isKingAndPawnOrBareKings(s.game.position), true);
  assert.equal(holdMaterialIntact(s.game, entry), true);
  assert.equal(s.status, 'in-progress');
  const ev = applyEngineEval(s.game, entry, s.game.moves[s.game.moves.length - 1], [{ kind: 'cp', value: 10 }]);
  assert.notEqual(ev.reason, 'collapsed');
  assert.notEqual(ev.status, 'failure');
});

test('a safe promotion to queen against a knight is a clear win', () => {
  const entry = {
    id: 'test-qn',
    title: 'Queen versus knight',
    fen: '8/P4n2/8/8/8/8/8/K6k w - - 0 1',
    playerColor: 'w',
    goal: 'win',
    success: { type: 'promote' },
    goalText: 'Promote or mate.',
  };
  const s = new EndgameSession(entry);
  const r = s.play('a7a8q');
  assert.equal(r.ok, true);
  assert.equal(promotionMaterialIsWinning(s.game, 'w'), true);
  assert.equal(s.status, 'success');
  assert.equal(s.reason, 'promotion');
});

test('a promotion whose material edge is a pawn short of a queen is not a success by itself', () => {
  const entry = {
    id: 'test-q2p',
    title: 'Queen versus two pawns',
    fen: '8/P4pp1/8/8/8/8/8/K6k w - - 0 1',
    playerColor: 'w',
    goal: 'win',
    success: { type: 'promote' },
    goalText: 'Promote or mate.',
  };
  const s = new EndgameSession(entry);
  const r = s.play('a7a8q');
  assert.equal(r.ok, true);
  assert.equal(promotionMaterialIsWinning(s.game, 'w'), false);
  assert.equal(s.status, 'in-progress');
});

test('EVAL_WIN_CP is 300 and a lower engine score leaves a promotion in progress', () => {
  assert.equal(EVAL_WIN_CP, 300);
  assert.equal(EVAL_LOST_CP, -200);
  const entry = {
    id: 'test-qmate',
    title: 'Queen promotion',
    fen: '8/P7/8/8/8/8/8/K6k w - - 0 1',
    playerColor: 'w',
    goal: 'win',
    success: { type: 'promote' },
    goalText: 'Promote or mate.',
  };
  const s = new EndgameSession(entry);
  assert.equal(s.play('a7a8q').ok, true);
  assert.equal(s.status, 'success');
  // After White promotes, it is Black to move, so a White score of +200 is a Black score of -200.
  const ev = s.applyEval([{ kind: 'cp', value: -200 }]);
  assert.equal(ev.status, 'in-progress');
  const evWin = s.applyEval([{ kind: 'cp', value: -400 }]);
  assert.equal(evWin.status, 'success');
  assert.equal(evWin.reason, 'promotion');
});

test('an unconfirmed hold or promotion is withdrawn if the engine check fails', () => {
  const s = new EndgameSession(endgameById('opposition'));
  s.status = 'success';
  s.reason = 'promotion';
  const ev = revertUnconfirmedEval(s);
  assert.equal(ev.status, 'in-progress');
  assert.equal(s.reason, null);
  s.status = 'failure';
  s.reason = 'collapsed';
  revertUnconfirmedEval(s);
  assert.equal(s.status, 'failure');
  assert.equal(s.reason, 'collapsed');
});


console.log(`\nEndgame tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
