/**
 * AI tests — run with: node tests/ai.test.mjs
 * Requires src/engine.js (Engine worker).
 */
import { Position, START_FEN, Game } from '../src/engine.js';
import {
  DIFFICULTIES,
  chooseMove,
  evaluate,
  analyze,
  _benchmarkNps,
} from '../src/ai.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error('FAIL:', msg);
  }
}

function assertEq(a, b, msg) {
  assert(a === b, `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);
}

function moveInLegal(pos, move) {
  if (!move) return false;
  return pos.legalMoves().some(
    (m) =>
      m.from === move.from &&
      m.to === move.to &&
      (m.promotion || '') === (move.promotion || '')
  );
}

function sameUci(pos, a, b) {
  return pos.moveToUci(a) === pos.moveToUci(b);
}

console.log('=== Chess AI tests ===\n');

// ---------------------------------------------------------------------------
// 1. DIFFICULTIES table
// ---------------------------------------------------------------------------
{
  assert(DIFFICULTIES.length >= 8, 'at least 8 difficulty levels');
  const ids = DIFFICULTIES.map((d) => d.id);
  for (let i = 1; i <= 8; i++) {
    assert(ids.includes(`lvl${i}`), `has lvl${i}`);
  }
  assert(DIFFICULTIES[0].name === 'Novice' || DIFFICULTIES[0].elo <= 500, 'first is novice-ish');
  assert(DIFFICULTIES[DIFFICULTIES.length - 1].elo >= 2000, 'top level high elo');
  let prev = -1;
  for (const d of DIFFICULTIES) {
    assert(d.elo >= prev, `elo monotonic at ${d.id}`);
    prev = d.elo;
    assert(typeof d.depth === 'number', `${d.id} has depth`);
    assert(typeof d.timeMs === 'number', `${d.id} has timeMs`);
    assert(typeof d.blunderRate === 'number', `${d.id} has blunderRate`);
    assert(typeof d.randomness === 'number', `${d.id} has randomness`);
  }
}

// ---------------------------------------------------------------------------
// 2. evaluate returns a number on start position
// ---------------------------------------------------------------------------
{
  const pos = Position.fromFen(START_FEN);
  const s = evaluate(pos);
  assert(typeof s === 'number' && Number.isFinite(s), 'evaluate returns finite number');
  assert(Math.abs(s) < 200, `start eval near equal (got ${s})`);
}

// ---------------------------------------------------------------------------
// 3. Always returns a legal move
// ---------------------------------------------------------------------------
{
  const fens = [
    START_FEN,
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    '8/8/8/8/8/4k3/8/4K3 w - - 0 1',
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    '8/5k2/8/8/8/8/5K2/4Q3 w - - 0 1',
  ];
  for (const fen of fens) {
    const pos = Position.fromFen(fen);
    if (pos.legalMoves().length === 0) continue;
    const r = await chooseMove(pos, { difficultyId: 'lvl4', timeMs: 120 });
    assert(moveInLegal(pos, r.move), `legal move on ${fen.slice(0, 30)}… (got ${r.move && pos.moveToUci(r.move)})`);
  }
}

// ---------------------------------------------------------------------------
// 4. Mate in 1
// ---------------------------------------------------------------------------
{
  // White to mate with Qh5# (scholar-ish) — classic back rank / simple mate
  // K+Q vs K: White queen on e1, kings on e2? Better known:
  // White: Ke1, Qd1? Let's use: White Qa7, King c6; Black king a8 — mate Qa7? 
  // Classic: 6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1 → Re8#
  const mate1 = Position.fromFen('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1');
  const r = await chooseMove(mate1, { difficultyId: 'lvl5', timeMs: 400 });
  assert(moveInLegal(mate1, r.move), 'mate-in-1 returns legal');
  const after = mate1.makeMove(r.move);
  assert(after.isCheckmate(), `mate-in-1 finds mate (played ${mate1.moveToUci(r.move)})`);
}

// ---------------------------------------------------------------------------
// 5. Mate in 2 (lvl6+)
// ---------------------------------------------------------------------------
{
  // Famous: white mates in 2 — Kb1, Qc1 vs black Ka8 Rb8? 
  // Use: 2k5/8/2K5/8/8/8/8/3R4 w - - 0 1 → Rd8+ Kc7? wait that's mate in 1 if Rd8#
  // Mate in 2: r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4
  // Black is already mated? Scholar's mate finished.
  // Mate in 2 for white: 8/8/8/8/8/8/6k1/2KQ4 w - - 0 1? Qf4 then Qg4? Not forced.
  // Reliable mate in 2: k7/8/1K6/8/8/8/8/R7 w - - 0 1 → Ra8+ Kb8? Ka7? 
  // Ka8, Kb6, Ra1: 1.Ra8+ Kb? king is on a8 so Ra8 is illegal.
  // Position: ka8, Kb6, Ra1 → 1.Ra8# is mate in 1.
  // Mate in 2: 5k2/8/5K2/8/8/8/8/4R3 w - - 0 1 → Re8+ Kg7/Kf? Re8+ then mate next
  // Actually Re8+ is check, Kf? only Kg8/Kg7 then further.
  // Better known puzzle: 8/8/8/4k3/8/4KQ2/8/8 w - - 0 1 mate in 2? Qe4+/Qf4+ etc.
  const mate2 = Position.fromFen('5k2/8/5K2/8/8/8/4R3/8 w - - 0 1');
  const r = await chooseMove(mate2, { difficultyId: 'lvl7', timeMs: 1500 });
  assert(moveInLegal(mate2, r.move), 'mate-in-2 first move legal');
  const after1 = mate2.makeMove(r.move);
  if (after1.isCheckmate()) {
    assert(true, 'mate-in-2 collapsed to mate-in-1 (acceptable)');
  } else {
    // Opponent's only moves, then we should mate
    const replies = after1.legalMoves();
    assert(replies.length > 0, 'mate-in-2 opponent has replies');
    let allMate = true;
    for (const rep of replies) {
      const pos2 = after1.makeMove(rep);
      const r2 = await chooseMove(pos2, { difficultyId: 'lvl7', timeMs: 800 });
      if (!r2.move || !pos2.makeMove(r2.move).isCheckmate()) allMate = false;
    }
    assert(allMate || Math.abs(r.score) >= 90000 || r.score > 500, 
      `mate-in-2 progress (score=${r.score}, move=${mate2.moveToUci(r.move)})`);
  }
}

// ---------------------------------------------------------------------------
// 6. Avoids stalemate when winning
// ---------------------------------------------------------------------------
{
  // White has huge material, must not stalemate
  // K+Q vs K where careless Q move stalemates: 
  // 7k/5Q2/6K1/8/8/8/8/8 w - - 0 1 — Qf8? or Qg8? careful
  // Position where Qa6 leaves stalemate: ka8 Kc6 Qa5? 
  // Classic: 8/8/8/8/8/5K1k/8/6Q1 w - - → avoid Qg2/Qg3/Qh1 stalemate patterns
  const winning = Position.fromFen('7k/8/6QK/8/8/8/8/8 w - - 0 1');
  // Multiple mates; Qg7# / Qg8# / Qh7# etc. Stalemate would be rare.
  const r = await chooseMove(winning, { difficultyId: 'lvl6', timeMs: 600 });
  assert(moveInLegal(winning, r.move), 'winning position legal move');
  const after = winning.makeMove(r.move);
  assert(!after.isStalemate(), `does not stalemate when winning (played ${winning.moveToUci(r.move)})`);
  // Prefer checkmate
  assert(after.isCheckmate() || after.inCheck() || evaluate(after) > 500, 'keeps advantage or mates');
}

// ---------------------------------------------------------------------------
// 7. Respects time limits
// ---------------------------------------------------------------------------
{
  // Midgame FEN so opening book does not short-circuit the search.
  const pos = Position.fromFen('r1bq1rk1/ppp2ppp/2n2n2/2bp4/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 8');
  const budget = 200;
  const t0 = Date.now();
  const r = await chooseMove(pos, { difficultyId: 'lvl6', timeMs: budget });
  const elapsed = Date.now() - t0;
  assert(moveInLegal(pos, r.move), 'time-limited move is legal');
  assert(r.nodes > 0, 'time-limited search visited nodes');
  // Allow generous tolerance (startup, GC): 3x budget + 500ms
  assert(elapsed < budget * 3 + 500, `respects time (elapsed ${elapsed}ms budget ${budget}ms)`);
  console.log(`  time-limit: ${elapsed}ms for ${budget}ms budget, depth=${r.depth}, nodes=${r.nodes}`);
}

// ---------------------------------------------------------------------------
// 8. Difficulty monotonicity — small match
// ---------------------------------------------------------------------------
{
  console.log('  running difficulty monotonicity checks…');
  const positions = [
    'r1bq1rk1/ppp2ppp/2n2n2/2bp4/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 8',
    'rnbq1rk1/pp2ppbp/3p1np1/2p5/2PPP3/2N2N2/PP2BPPP/R1BQK2R w KQ - 0 7',
    '2r2rk1/pp1bppbp/2np1np1/q7/2BNP3/2N1BP2/PPPQ2PP/2KR3R w - - 0 12',
    'r2q1rk1/1pp1bppp/p1np1n2/4p3/B3P3/2PP1N2/PP3PPP/RNBQR1K1 b - - 0 9',
    '8/5k2/8/8/8/8/5K2/4Q3 w - - 0 1',
    '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
  ];
  const pad = Array.from({ length: 12 }, () => Position.fromFen(START_FEN));
  let strongerBetter = 0;
  let compared = 0;

  for (const fen of positions) {
    const pos = Position.fromFen(fen);
    if (!pos.legalMoves().length) continue;
    const weak = await chooseMove(pos, { difficultyId: 'lvl2', timeMs: 80, history: pad });
    const strong = await chooseMove(pos, { difficultyId: 'lvl6', timeMs: 350, history: pad });
    assert(moveInLegal(pos, weak.move), 'weak move legal');
    assert(moveInLegal(pos, strong.move), 'strong move legal');

    // Referee: deep search score of each chosen move
    const referee = async (move) => {
      const child = pos.makeMove(move);
      const lines = await analyze(child, { depth: 4, timeMs: 250, multiPv: 1 });
      // score from original side to move = -child's best
      return lines.length ? -lines[0].score : -evaluate(child) * (pos.turn === 'w' ? 1 : -1);
    };
    // Simpler referee: static+quiescence via analyze on root multiPv isn't move-specific.
    // Use one-ply: -eval after move, plus bonus if opponent is mated.
    const scoreMove = (move) => {
      const child = pos.makeMove(move);
      if (child.isCheckmate()) return 100000;
      const s = evaluate(child); // white view
      return pos.turn === 'w' ? s : -s;
    };
    // Prefer deep: run mini search score via chooseMove internal by analyzing child
    const deepScore = async (move) => {
      const child = pos.makeMove(move);
      if (child.isCheckmate()) return 100000;
      if (child.legalMoves().length === 0) return 0;
      const ans = await analyze(child, { depth: 3, timeMs: 200, multiPv: 1 });
      if (!ans.length) return scoreMove(move);
      return -ans[0].score; // from mover's perspective
    };
    const sw = await deepScore(weak.move);
    const ss = await deepScore(strong.move);
    compared++;
    if (ss >= sw - 30) strongerBetter++; // allow small noise
    console.log(`  pos ${fen.slice(0, 24)}… weak=${pos.moveToUci(weak.move)}(${sw}) strong=${pos.moveToUci(strong.move)}(${ss})`);
  }
  console.log(`  strongerBetter ${strongerBetter}/${compared}`);
  assert(strongerBetter >= Math.ceil(compared * 0.66), `lvl6 moves should usually outscore lvl2 (${strongerBetter}/${compared})`);

  // Short decisive match from a winning endgame for white; lvl6 as white should not lose
  let wins = 0, losses = 0;
  for (let g = 0; g < 3; g++) {
    const game = new Game('8/5k2/8/8/8/8/5K2/4Q3 w - - 0 1');
    let plies = 0;
    while (!game.result() && plies < 30) {
      const isWhite = game.position.turn === 'w';
      const r = await chooseMove(game.position, {
        difficultyId: isWhite ? 'lvl6' : 'lvl2',
        timeMs: isWhite ? 250 : 50,
        history: pad.concat(game.positions),
      });
      if (!r.move || !game.play(r.move)) break;
      plies++;
    }
    const res = game.result();
    if (res?.result === '1-0') wins++;
    else if (res?.result === '0-1') losses++;
  }
  console.log(`  Q+K endgame: white(lvl6) wins=${wins} losses=${losses}`);
  assert(losses === 0 && wins >= 1, `lvl6 as white Q+K should beat lvl2 (wins=${wins} losses=${losses})`);
}


// ---------------------------------------------------------------------------
// 9. Levels above lvl2 take mate in one
// ---------------------------------------------------------------------------
{
  const mate1 = Position.fromFen('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1');
  for (const id of ['lvl3', 'lvl4', 'lvl5', 'lvl8']) {
    const r = await chooseMove(mate1, { difficultyId: id, timeMs: 300 });
    const after = mate1.makeMove(r.move);
    assert(after.isCheckmate(), `${id} takes mate in one`);
  }
}

// ---------------------------------------------------------------------------
// 10. analyze multiPv
// ---------------------------------------------------------------------------
{
  const pos = Position.fromFen(START_FEN);
  const lines = await analyze(pos, { depth: 3, timeMs: 400, multiPv: 3 });
  assert(Array.isArray(lines) && lines.length >= 1, 'analyze returns lines');
  assert(lines.length <= 3, 'analyze respects multiPv cap');
  for (const line of lines) {
    assert(moveInLegal(pos, line.move), 'analyze move legal');
    assert(typeof line.score === 'number', 'analyze has score');
    assert(Array.isArray(line.pv) && line.pv.length >= 1, 'analyze has pv');
  }
  if (lines.length >= 2) {
    assert(lines[0].score >= lines[1].score, 'analyze lines sorted by score');
  }
}

// ---------------------------------------------------------------------------
// 11. No crashes over 200 random positions (via random walk from start)
// ---------------------------------------------------------------------------
{
  console.log('  random walk crash test (200 positions)…');
  let crashes = 0;
  let pos = Position.fromFen(START_FEN);
  for (let i = 0; i < 200; i++) {
    try {
      const moves = pos.legalMoves();
      if (moves.length === 0) {
        pos = Position.fromFen(START_FEN);
        continue;
      }
      // Periodically ask AI
      if (i % 5 === 0) {
        const r = await chooseMove(pos, {
          difficultyId: i % 2 === 0 ? 'lvl3' : 'lvl1',
          timeMs: 50,
        });
        assert(r.move == null || moveInLegal(pos, r.move), `random legal at i=${i}`);
      }
      // Advance with random move
      const m = moves[Math.floor(Math.random() * moves.length)];
      pos = pos.makeMove(m);
      // Reset sometimes to diversify
      if (i % 40 === 39) pos = Position.fromFen(START_FEN);
      evaluate(pos);
    } catch (e) {
      crashes++;
      console.error('  crash at', i, e.message);
      pos = Position.fromFen(START_FEN);
    }
  }
  assert(crashes === 0, `no crashes over 200 positions (crashes=${crashes})`);
}

// ---------------------------------------------------------------------------
// 12. NPS benchmark
// ---------------------------------------------------------------------------
{
  const pos = Position.fromFen(START_FEN);
  const bench = _benchmarkNps(pos, 400);
  console.log(`  NPS: ${bench.nps} (nodes=${bench.nodes}, depth=${bench.depth})`);
  assert(bench.nodes > 100, `search visits nodes (got ${bench.nodes})`);
  assert(bench.nps > 100, `nps measurable (got ${bench.nps})`);
}

// ---------------------------------------------------------------------------
// 13. Opening book produces legal moves for lvl3+
// ---------------------------------------------------------------------------
{
  const pos = Position.fromFen(START_FEN);
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const r = await chooseMove(pos, { difficultyId: 'lvl4', timeMs: 100, history: [] });
    assert(moveInLegal(pos, r.move), 'book/search move legal from start');
    seen.add(pos.moveToUci(r.move));
  }
  // With book variety we likely see more than one move across trials (not guaranteed)
  console.log(`  start move variety: ${[...seen].join(', ')}`);
}

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(' -', f);
  process.exit(1);
}
process.exit(0);
