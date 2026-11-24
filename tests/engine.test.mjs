// Engine tests: run with `node tests/engine.test.mjs` (add --quick to skip the deepest perft).
import assert from 'node:assert/strict';
import { Position, Game, perft, perftDivide, START_FEN, PIECE_VALUES, Board, parseSquare, squareName, moveToUci, splitPgnGames } from '../src/engine.js';

let passed = 0, failed = 0;
const quick = process.argv.includes('--quick');
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
const sq = parseSquare;
const P = (f) => Position.fromFen(f);
const playAll = (g, sans) => { for (const s of sans.split(/\s+/).filter(Boolean)) assert.ok(g.playSan(s), 'could not play ' + s); };

// ---------- perft ----------
const PERFT = [
  ['start', START_FEN, [20, 400, 8902, 197281, 4865609]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
  ['pos3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  // Standard CPW position 4 (the brief's copy had "nPP5/BB2P3", a typo for "nP6/BBP1P3").
  ['pos4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['pos4-mirrored', 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', [6, 264, 9467, 422333]],
  ['pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
  ['pos6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];
const timings = [];
for (const [name, fen, counts] of PERFT) {
  counts.forEach((n, i) => {
    const d = i + 1;
    if (quick && n > 1e6) return;
    test(`perft ${name} depth ${d} = ${n}`, () => {
      const t = performance.now(); const got = perft(P(fen), d); const ms = performance.now() - t;
      if (n > 1e5) timings.push(`${name} d${d}: ${ms.toFixed(0)} ms`);
      assert.equal(got, n);
    });
  });
}
test('perftDivide sums to perft', () => {
  const div = perftDivide(P(START_FEN), 3);
  assert.equal(Object.keys(div).length, 20);
  assert.equal(Object.values(div).reduce((a, b) => a + b, 0), 8902);
});

// ---------- FEN, basic API ----------
test('START_FEN round-trips and exposes fields', () => {
  const p = P(START_FEN);
  assert.equal(p.toFen(), START_FEN);
  assert.equal(p.turn, 'w');
  assert.deepEqual(p.board[0], { color: 'w', type: 'r' });
  assert.deepEqual(p.board[60], { color: 'b', type: 'k' });
  assert.equal(p.board[30], null);
  assert.equal(p.board.length, 64);
  assert.deepEqual({ ...p.castling }, { wK: true, wQ: true, bK: true, bQ: true });
  assert.equal(p.epSquare, null);
  assert.equal(p.halfmove, 0); assert.equal(p.fullmove, 1);
  assert.deepEqual(PIECE_VALUES, { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 });
});
test('makeMove is immutable and sets ep square', () => {
  const p = P(START_FEN);
  const q = p.makeMove({ from: sq('e2'), to: sq('e4') });
  assert.equal(p.toFen(), START_FEN);
  assert.equal(q.toFen(), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  assert.equal(q.epSquare, sq('e3'));
});
test('invalid FENs throw readable errors', () => {
  for (const bad of ['', 'xyz', '8/8/8/8/8/8/8/8 w - - 0 1', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1',
    'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'k7/8/8/8/8/8/8/K6r b - - 0 1', 'P3k3/8/8/8/8/8/8/4K3 w - - 0 1']) {
    assert.throws(() => P(bad), /FEN/, bad);
  }
});
test('inconsistent castling rights are dropped', () => {
  assert.equal(P('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1').toFen(), '4k3/8/8/8/8/8/8/4K3 w - - 0 1');
});
test('legal move objects follow the contract', () => {
  const p = P(START_FEN);
  const m = p.legalMoves().find((x) => x.from === sq('e2') && x.to === sq('e4'));
  assert.equal(m.piece, 'p'); assert.equal(m.captured, null); assert.equal(m.flags, 'd'); assert.equal(m.promotion, undefined);
  assert.equal(p.legalMovesFrom(sq('g1')).length, 2);
  assert.equal(p.legalMovesFrom(sq('e1')).length, 0);
});
test('UCI parse and format', () => {
  const p = P(START_FEN);
  const m = p.parseUci('g1f3');
  assert.equal(m.from, sq('g1')); assert.equal(p.moveToUci(m), 'g1f3');
  assert.equal(p.parseUci('e2e5'), null);
  assert.equal(p.parseUci('nonsense'), null);
  const pr = P('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
  assert.equal(pr.parseUci('e7e8n').promotion, 'n');
  assert.equal(moveToUci(pr.parseUci('e7e8q')), 'e7e8q');
  const c = P('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(c.parseUci('e1h1').flags, 'k'); // king-takes-rook notation
});
test('check, checkmate and stalemate detection', () => {
  const mate = P('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  assert.ok(mate.inCheck()); assert.ok(mate.isCheckmate()); assert.ok(!mate.isStalemate());
  const stale = P('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.ok(!stale.inCheck()); assert.ok(stale.isStalemate()); assert.ok(!stale.isCheckmate());
  assert.ok(P('4k3/4R3/8/8/8/8/8/4K3 b - - 0 1').inCheck());
  assert.ok(!P(START_FEN).inCheck());
});

// ---------- castling ----------
test('castling moves and rights loss', () => {
  const p = P('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const ks = p.parseSan('O-O'), qs = p.parseSan('O-O-O');
  assert.equal(ks.flags, 'k'); assert.equal(qs.flags, 'q');
  assert.equal(p.makeMove(ks).toFen(), 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
  assert.equal(p.makeMove(qs).toFen(), 'r3k2r/8/8/8/8/8/8/2KR3R b kq - 1 1');
  // rook move loses one side
  assert.equal(p.makeMove(p.parseSan('Rh2')).toFen().split(' ')[2], 'Qkq');
  // king move loses both
  assert.equal(p.makeMove(p.parseSan('Kd1')).toFen().split(' ')[2], 'kq');
  // capturing a rook on its home square removes the opponent's right
  const cap = P('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1').makeMove({ from: sq('a1'), to: sq('a8') });
  assert.equal(cap.toFen().split(' ')[2], 'Kk');
  assert.deepEqual({ ...cap.castling }, { wK: true, wQ: false, bK: true, bQ: false });
});
test('cannot castle out of, through, or into check', () => {
  assert.equal(P('1k3r2/8/8/8/8/8/8/R3K2R w KQ - 0 1').parseSan('O-O'), null);          // f1 attacked
  assert.ok(P('1k3r2/8/8/8/8/8/8/R3K2R w KQ - 0 1').parseSan('O-O-O'));
  assert.equal(P('1k2r3/8/8/8/8/8/8/R3K2R w KQ - 0 1').parseSan('O-O'), null);          // in check
  assert.equal(P('1k4r1/8/8/8/8/8/8/R3K2R w KQ - 0 1').parseSan('O-O'), null);           // g1 attacked
  assert.ok(P('1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1').parseSan('O-O-O'));                // b1 attacked is fine
  assert.equal(P('4k3/8/8/8/8/8/8/RN2K2R w KQ - 0 1').parseSan('O-O-O'), null);         // b1 occupied
});

// ---------- en passant ----------
test('en passant capture', () => {
  const p = P('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
  const m = p.parseSan('exd6');
  assert.equal(m.flags, 'ce'); assert.equal(m.captured, 'p');
  assert.equal(p.makeMove(m).toFen(), '4k3/8/3P4/8/8/8/8/4K3 b - - 0 2');
});
test('en passant illegal when the pawn is pinned horizontally', () => {
  const p = P('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1');
  assert.equal(p.parseSan('exd6'), null);
  assert.ok(!p.legalMoves().some((m) => m.flags.includes('e')));
  assert.equal(p.hash().split(' ')[3], '-'); // effective ep ignored for repetition
});
test('en passant illegal when the capturing pawn is pinned diagonally', () => {
  // white king a1, black bishop h8: the e5 pawn is pinned on the long diagonal
  const pin = P('4k2b/8/8/3pP3/8/8/8/K7 w - d6 0 1');
  assert.equal(pin.parseSan('exd6'), null);
  // capturing along the pin line stays legal: king h2, bishop b8, exd6 keeps the diagonal blocked
  assert.ok(P('kb6/8/8/3pP3/8/8/7K/8 w - d6 0 1').parseSan('exd6'));
  assert.ok(P('k7/8/8/3pP3/8/8/8/7K w - d6 0 1').parseSan('exd6'));
});
test('en passant that removes a checking pawn is legal', () => {
  const p = P('8/8/8/3pP3/4K3/8/8/7k w - d6 0 1');
  assert.ok(p.inCheck());
  assert.ok(p.parseSan('exd6'));
});
test('invalid ep square in FEN is ignored', () => {
  assert.equal(P('4k3/8/8/8/8/8/8/4K3 w - e6 0 1').epSquare, null);
});

// ---------- promotion ----------
test('promotion to all four pieces, with and without capture', () => {
  const p = P('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const promos = p.legalMoves().filter((m) => m.flags.includes('p'));
  assert.equal(promos.length, 8);
  for (const t of ['q', 'r', 'b', 'n']) {
    const m = p.parseSan('a8=' + t.toUpperCase());
    assert.equal(m.promotion, t);
    const q = p.makeMove(m);
    assert.deepEqual(q.board[sq('a8')], { color: 'w', type: t });
    const c = p.parseSan('axb8=' + t.toUpperCase());
    assert.equal(c.captured, 'r'); assert.equal(c.flags, 'cp');
  }
  assert.equal(p.toSan(p.parseSan('a8=Q')), 'a8=Q');
  assert.equal(P('4k3/P7/8/8/8/8/8/4K3 w - - 0 1').toSan({ from: sq('a7'), to: sq('a8'), promotion: 'q' }), 'a8=Q+');
  assert.equal(p.toSan(p.parseSan('axb8=N')), 'axb8=N');
  assert.equal(p.parseSan('a8Q').promotion, 'q');
  // promotion omitted in a move object defaults to queen
  assert.equal(p.makeMove({ from: sq('a7'), to: sq('a8') }).board[sq('a8')].type, 'q');
  const bl = P('4k3/8/8/8/8/8/p7/4K3 b - - 0 1');
  assert.equal(bl.makeMove(bl.parseUci('a2a1n')).board[0].type, 'n');
});

// ---------- SAN ----------
test('SAN disambiguation by file, rank and square', () => {
  assert.equal(P('7k/8/8/8/8/8/8/R4RK1 w - - 0 1').toSan({ from: sq('a1'), to: sq('d1') }), 'Rad1');
  assert.equal(P('7k/R7/8/8/8/8/8/R5K1 w - - 0 1').toSan({ from: sq('a1'), to: sq('a4') }), 'R1a4');
  assert.equal(P('k7/8/8/8/8/2Q1Q3/8/2Q3K1 w - - 0 1').toSan({ from: sq('c3'), to: sq('d2') }), 'Qc3d2');
  assert.equal(P('k7/8/8/8/8/2N1N3/8/6K1 w - - 0 1').toSan({ from: sq('c3'), to: sq('d5') }), 'Ncd5');
  // a pinned knight does not cause disambiguation
  assert.equal(P('k7/8/8/8/1q6/2N1N3/8/4K3 w - - 0 1').toSan({ from: sq('e3'), to: sq('d5') }), 'Nd5');
});
test('SAN: castling, captures, check and mate suffixes, parse leniency', () => {
  const g = new Game();
  playAll(g, 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6');
  assert.deepEqual(g.sans.slice(-4), ['Nxf7', 'Kxf7', 'Qf3+', 'Ke6']);
  const m = new Game(); playAll(m, 'f3 e5 g4 Qh4#');
  assert.equal(m.sans[3], 'Qh4#');
  const p = P(START_FEN);
  assert.equal(p.parseSan('Ng1f3').to, sq('f3'));
  assert.equal(p.parseSan('Nf3!?').to, sq('f3'));
  assert.equal(p.parseSan('e2-e4').to, sq('e4'));
  assert.equal(p.parseSan('Nf4'), null);
  assert.equal(p.parseSan('Ke2'), null);
  const c = P('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(c.parseSan('0-0').flags, 'k'); assert.equal(c.toSan(c.parseSan('O-O-O')), 'O-O-O');
});
test('every legal SAN round-trips through parseSan (kiwipete tree)', () => {
  const root = P('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  for (const a of root.legalMoves()) {
    const p = root.makeMove(a);
    for (const m of p.legalMoves()) {
      const back = p.parseSan(p.toSan(m));
      assert.ok(back && back.from === m.from && back.to === m.to && back.promotion === m.promotion, p.toSan(m));
    }
  }
});

// ---------- draw rules ----------
test('threefold repetition is an automatic draw', () => {
  const g = new Game();
  playAll(g, 'Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1');
  assert.equal(g.result(), null);
  assert.equal(g.repetitionCount(), 2);
  assert.ok(g.playSan('Ng8'));
  assert.deepEqual(g.result(), { result: '1/2-1/2', reason: 'threefold' });
  assert.equal(g.play(g.position.legalMoves()[0]), false);
});
test('repetition respects castling rights and ep', () => {
  const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  playAll(g, 'Kf1 Kf8 Ke1 Ke8 Kf1 Kf8 Ke1 Ke8');
  // the initial position had castling rights, so it has occurred once; later ones twice
  assert.equal(g.result(), null);
  playAll(g, 'Kf1 Kf8');
  assert.deepEqual(g.result(), { result: '1/2-1/2', reason: 'threefold' });
});
test('fifty-move rule', () => {
  const g = new Game('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
  assert.equal(g.result(), null);
  g.playSan('Ra2');
  assert.deepEqual(g.result(), { result: '1/2-1/2', reason: 'fifty-move' });
  assert.ok(P('4k3/8/8/8/8/8/8/R3K3 w - - 100 80').isFiftyMoveDraw());
  // checkmate on the 100th half-move takes precedence
  const m = new Game('k7/8/1K6/8/8/8/8/7R w - - 99 80');
  m.playSan('Rh8#');
  assert.equal(m.result().reason, 'checkmate');
  // a pawn move resets the counter
  assert.equal(P('4k3/8/8/8/8/8/4P3/4K3 w - - 99 80').makeMove(P('4k3/8/8/8/8/8/4P3/4K3 w - - 99 80').parseSan('e3')).halfmove, 0);
});
test('insufficient material', () => {
  const ins = (f) => P(f).isInsufficientMaterial();
  assert.ok(ins('4k3/8/8/8/8/8/8/4K3 w - - 0 1'));
  assert.ok(ins('4k3/8/8/8/8/8/8/2N1K3 w - - 0 1'));
  assert.ok(ins('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1'));
  assert.ok(ins('2b1k3/8/8/8/8/8/8/3BK3 w - - 0 1'));  // c8 and d1 both light squares
  assert.ok(!ins('3bk3/8/8/8/8/8/8/3BK3 w - - 0 1'));  // d8 dark, d1 light
  assert.ok(!ins('4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1'));
  assert.ok(!ins('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'));
  assert.ok(!ins('4k3/8/8/8/8/8/8/3RK3 w - - 0 1'));
  const g = new Game('4k3/8/8/8/8/8/3r4/3QK3 w - - 0 1');
  g.playSan('Qxd2');
  assert.equal(g.result(), null);
  assert.ok(g.playSan('Kf7'));
  assert.equal(g.result(), null); // K+Q vs K is not a draw
  const g2 = new Game('4k3/8/8/8/8/8/3q4/4K3 w - - 0 1');
  g2.playSan('Kxd2');
  assert.deepEqual(g2.result(), { result: '1/2-1/2', reason: 'insufficient' });
});
test('game results: checkmate, stalemate, resign, agreement, timeout', () => {
  const g = new Game(); playAll(g, 'f3 e5 g4 Qh4#');
  assert.deepEqual(g.result(), { result: '0-1', reason: 'checkmate' });
  assert.equal(g.resign('w'), false);
  const s = new Game('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.deepEqual(s.result(), { result: '1/2-1/2', reason: 'stalemate' });
  const r = new Game(); r.playSan('e4'); assert.ok(r.resign('b'));
  assert.deepEqual(r.result(), { result: '1-0', reason: 'resignation' });
  assert.equal(r.play(r.position.legalMoves()[0]), false);
  const a = new Game(); assert.ok(a.drawByAgreement()); assert.deepEqual(a.result(), { result: '1/2-1/2', reason: 'agreement' });
  const t = new Game(); t.timeout('w'); assert.deepEqual(t.result(), { result: '0-1', reason: 'timeout' });
  const t2 = new Game('4k3/8/8/8/8/8/8/QQQQK3 w - - 0 1'); t2.timeout('w');
  assert.deepEqual(t2.result(), { result: '1/2-1/2', reason: 'timeout' }); // lone king cannot win on time
});

// ---------- Game navigation ----------
test('Game undo, redo, goto and redo-stack clearing', () => {
  const g = new Game();
  playAll(g, 'e4 e5 Nf3 Nc6');
  assert.equal(g.moves.length, 4); assert.equal(g.positions.length, 5);
  assert.ok(g.undo()); assert.ok(g.undo());
  assert.deepEqual(g.sans, ['e4', 'e5']);
  assert.equal(g.position.toFen(), g.positions[2].toFen());
  assert.ok(g.redo()); assert.deepEqual(g.sans, ['e4', 'e5', 'Nf3']);
  assert.ok(g.goto(0)); assert.equal(g.position.toFen(), START_FEN); assert.equal(g.undo(), false);
  g.goto(99); assert.equal(g.ply, 4); assert.equal(g.redo(), false);
  g.goto(2);
  assert.ok(g.playSan('Bc4'));
  assert.deepEqual(g.sans, ['e4', 'e5', 'Bc4']);
  assert.equal(g.redo(), false); assert.equal(g.length, 3);
  assert.equal(g.play({ from: sq('e1'), to: sq('e3') }), false);
  assert.equal(g.play('e7e5'), false);
  assert.ok(g.play('g8f6'));
  assert.ok(g.position instanceof Position);
});

// ---------- PGN ----------
const PGN_SAMPLE = `[Event "Club \\"Championship\\""]
[Site "Home"]
[Date "2024.01.02"]
[Round "3"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[ECO "C50"]

{Opening comment} 1. e4 e5 2. Nf3 {Develops} (2. f4 exf4 {gambit} (2... d5)) 2... Nc6 $1 3. Bc4 Bc5?! 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 ; rest of line
Nxe4 8. O-O Bxc3 9. d5 Bf6 10. Re1 Ne7 11. Rxe4 d6 12. Bg5 Bxg5 13. Nxg5 h6 14. Qe2 hxg5 15. Re1 Be6 16. dxe6 f6 17. Re3 c6 18. Rh3 Rxh3 19. gxh3 g6 20. Qf3 Qa5 21. Rd1 1-0
`;
test('PGN import with headers, comments, variations, NAGs', () => {
  const g = Game.fromPgn(PGN_SAMPLE);
  assert.equal(g.headers.Event, 'Club "Championship"');
  assert.equal(g.headers.ECO, 'C50');
  assert.equal(g.moves.length, 41);
  assert.equal(g.sans[2], 'Nf3'); assert.equal(g.sans[3], 'Nc6');
  assert.equal(g.comments[0], 'Opening comment');
  assert.equal(g.comments[3], 'Develops');
  assert.equal(g.comments[13], 'rest of line');
  assert.deepEqual(g.nags[4], [1]); assert.deepEqual(g.nags[6], [6]);
  assert.deepEqual(g.result(), { result: '1-0', reason: 'resignation' });
});
test('PGN round-trip: export, re-import, identical moves, headers, comments', () => {
  const g = Game.fromPgn(PGN_SAMPLE);
  const out = g.toPgn();
  assert.ok(out.startsWith('[Event "Club \\"Championship\\""]\n[Site "Home"]'));
  assert.ok(out.includes('{Develops} 2... Nc6 $1'));
  assert.ok(out.trim().endsWith('1-0'));
  for (const line of out.split('\n')) assert.ok(line.length <= 80 || line.startsWith('['));
  const g2 = Game.fromPgn(out);
  assert.deepEqual(g2.sans, g.sans);
  assert.deepEqual(g2.headers, g.headers);
  assert.deepEqual(g2.comments, g.comments);
  assert.deepEqual(g2.nags, g.nags);
  assert.equal(g2.toPgn(), out);
  assert.ok(g.toPgn({ White: 'Carol' }).includes('[White "Carol"]'));
});
test('PGN with FEN/SetUp, black to move first, and checkmate result', () => {
  const g = new Game('6k1/p4ppp/8/8/8/8/5PPP/3R2K1 b - - 0 30');
  playAll(g, 'a6 Rd8#');
  const pgn = g.toPgn({ White: 'W' });
  assert.ok(pgn.includes('[SetUp "1"]') && pgn.includes('[FEN "6k1/p4ppp/8/8/8/8/5PPP/3R2K1 b - - 0 30"]'));
  assert.ok(pgn.includes('30... a6 31. Rd8# 1-0'));
  const back = Game.fromPgn(pgn);
  assert.equal(back.startFen, g.startFen);
  assert.deepEqual(back.result(), { result: '1-0', reason: 'checkmate' });
  assert.equal(new Game().toPgn().trim().split('\n').pop(), '*');
});
test('PGN errors and multiple games', () => {
  assert.throws(() => Game.fromPgn('1. e4 e5 2. Ke3'), /Illegal or unreadable move "Ke3"/);
  assert.throws(() => Game.fromPgn(''), /empty/);
  const two = '[Event "A"]\n\n1. e4 *\n\n[Event "B"]\n\n1. d4 d5 *\n';
  const parts = splitPgnGames(two);
  assert.equal(parts.length, 2);
  assert.deepEqual(Game.fromPgn(parts[1]).sans, ['d4', 'd5']);
  assert.deepEqual(Game.fromPgn(two).sans, ['e4']);
  const tf = Game.fromPgn('[Result "0-1"]\n[Termination "time forfeit"]\n\n1. e4 0-1');
  assert.deepEqual(tf.result(), { result: '0-1', reason: 'timeout' });
  const glued = Game.fromPgn('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 1/2-1/2');
  assert.deepEqual(glued.result(), { result: '1/2-1/2', reason: 'agreement' });
  assert.equal(glued.sans.length, 6);
});

// ---------- JSON ----------
test('JSON round-trip exactly, including results, cursor and comments', () => {
  const g = Game.fromPgn(PGN_SAMPLE);
  const j = g.toJSON();
  assert.equal(j.version, 1); assert.equal(j.startFen, START_FEN);
  assert.equal(j.uci[0], 'e2e4');
  assert.deepEqual(j.resultInfo, { result: '1-0', reason: 'resignation', ply: 41 });
  const g2 = Game.fromJSON(JSON.parse(JSON.stringify(j)));
  assert.deepEqual(g2.toJSON(), j);
  assert.deepEqual(g2.sans, g.sans);
  assert.deepEqual(g2.result(), g.result());
  const s = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  playAll(s, 'O-O O-O-O Rf7');
  s.undo();
  const sj = s.toJSON();
  assert.deepEqual(sj, { version: 1, startFen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', uci: ['e1g1', 'e8c8', 'f1f7'], resultInfo: null, ply: 2 });
  const s2 = Game.fromJSON(JSON.stringify(sj));
  assert.equal(s2.ply, 2); assert.ok(s2.redo()); const { ply: _omit, ...atEnd } = sj;
  assert.deepEqual(s2.toJSON(), atEnd);
  const plain = new Game(); assert.deepEqual(plain.toJSON(), { version: 1, startFen: START_FEN, uci: [], resultInfo: null });
});
test('fromJSON rejects bad data with readable errors', () => {
  assert.throws(() => Game.fromJSON({ version: 2, uci: [] }), /version/);
  assert.throws(() => Game.fromJSON({ version: 1, startFen: START_FEN, uci: ['e2e5'] }), /illegal move "e2e5"/);
  assert.throws(() => Game.fromJSON('{not json'), /JSON/);
  assert.throws(() => Game.fromJSON({ version: 1, startFen: 'bad', uci: [] }), /start position/);
});

// ---------- internals for the bot ----------
test('Board make/unmake restores state and incremental zobrist matches', () => {
  const b = Position.fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1').toBoard();
  const fen0 = b.toFen(), h0 = b.zobrist;
  const walk = (d) => {
    if (!d) return;
    for (const m of b.legalCodes()) {
      const f = b.toFen(); b.make(m);
      const lo = b.hashLo, hi = b.hashHi; b.computeHash();
      assert.ok(lo === b.hashLo && hi === b.hashHi, 'hash mismatch after ' + m);
      walk(d - 1); b.unmake(m);
      assert.equal(b.toFen(), f);
    }
  };
  walk(2);
  assert.equal(b.toFen(), fen0); assert.equal(b.zobrist, h0);
  b.makeNull(); assert.equal(b.side, 1); b.unmakeNull(); assert.equal(b.zobrist, h0);
  assert.ok(b instanceof Board);
  assert.equal(squareName(sq('g7')), 'g7');
});
test('positions reached by different move orders share hash() and zobrist', () => {
  const a = new Game(); playAll(a, 'Nf3 Nf6 Nc3');
  const c = new Game(); playAll(c, 'Nc3 Nf6 Nf3');
  assert.equal(a.position.hash(), c.position.hash());
  assert.equal(a.position.zobrist, c.position.zobrist);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (timings.length) console.log('perft timings: ' + timings.join('; '));
if (failed) process.exit(1);
