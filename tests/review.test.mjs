// Tests for post-game classification, accuracy, mistake-puzzle margins, and
// the review cache. These tests use hardcoded expected judgments so that
// disabling a band, the Miss rule, or the uniqueness margins makes
// the matching assertion fail. Run: node tests/review.test.mjs
import fs from 'node:fs';
import { MemoryStorage } from '../src/storage.js';
import {
  classifyMove, accuracyPercent, accuracyFromWinPercents, winPercent, isMissedWin,
  passesMarginRules, passesMistakeMarginRules, buildReview, isUserMove, reviewFingerprint,
  inspectMistakePuzzle, verifyMistakePuzzle, gameAccuracy, harmonicMean, weightedMean,
  standardDeviation, REVIEW_DEPTH, SCHEME_VERSION, SCHEME_ID,
  EP_EXCELLENT, EP_GOOD, EP_INACCURACY, EP_MISTAKE, WIN_CP, GAP_CP, ALT_WIN_CP, ALT_MARGIN_CP, MISS_AFTER_CP,
  JUDGMENTS, CP_CEILING, ACC_UNCERTAINTY, MATE_MISTAKE_CP, MATE_INACCURACY_CP,
  classifyByExpectedPoints, isPieceSacrifice, isLandingSacrifice, staticExchange, maxStaticExchange,
  hangingExchanges, hasSavingAlternative, sacrificeAlternatives,
  SACRIFICE_CP, BRILLIANT_SAFE_WP, fenWithNullMove, threatIsMeaningful, threatExchangeGain,
  lineEvalAtStep, mateLength, MATE_THREAT_MAX,
  replayGame, reviewArrowsForMove,
} from '../src/review.js';
import { Position, START_FEN } from '../src/engine.js';
import { engineArrowGeometry } from '../src/ui/annotations.js';
import { createReviewStore } from '../src/review-storage.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
}

const line = (move, value, kind = 'cp') => ({ move, kind, value });

// ---- Accuracy formula (Lichess constants, including the +1 uncertainty bonus) ----
check('a loss of 0 percentage points scores 100 accuracy', accuracyPercent(0) === 100);
check('a loss of 10 percentage points scores about 64.580 accuracy', Math.abs(accuracyPercent(10) - 64.57982845372067) < 1e-9);
check('a loss of 20 percentage points scores about 41.017 accuracy', Math.abs(accuracyPercent(20) - 41.016818741417126) < 1e-9);
check('a loss of 30 percentage points scores about 25.772 accuracy', Math.abs(accuracyPercent(30) - 25.772047746869696) < 1e-9);
check('the +1 uncertainty bonus is included in the accuracy formula', ACC_UNCERTAINTY === 1 && accuracyFromWinPercents(60, 50) === accuracyPercent(10));
check('a move that does not lose winning chances scores 100', accuracyFromWinPercents(40, 55) === 100);
check('accuracy is never above 100 or below 0', accuracyPercent(-5) === 100 && accuracyPercent(1000) === 0);

// ---- Expected-points bands at exact crossing points from a 0.00 evaluation ----
// Centipawn values were measured against the chess.com V2 0.02 / 0.05 / 0.10 /
// 0.20 expected-points cuts, using this application's rating-neutral
// approximation, so a return to the Lichess 5/10/15-point table fails.
const c = (best, played, isBest = false, extra = {}) => classifyMove({ bestCp: best, playedCp: played, isBestMove: isBest, legalCount: 4, ...extra });

check('an equal move that is the engine choice is best', c(0, 0, true).judgment === 'best' && c(0, 0, true).accuracy === 100);
check('a zero loss that is not marked best-move is still best', c(0, 0).judgment === 'best');
check('a loss just under 0.02 expected points is excellent', c(0, -21).judgment === 'excellent', `loss ${c(0, -21).epLoss.toFixed(5)}`);
check('a loss of just over 0.02 expected points is good', c(0, -22).judgment === 'good', `loss ${c(0, -22).epLoss.toFixed(5)}`);
check('a loss just under 0.05 expected points is good', c(0, -54).judgment === 'good', `loss ${c(0, -54).epLoss.toFixed(5)}`);
check('a loss of just over 0.05 expected points is an inaccuracy', c(0, -55).judgment === 'inaccuracy', `loss ${c(0, -55).epLoss.toFixed(5)}`);
check('a loss just under 0.10 expected points is an inaccuracy', c(0, -110).judgment === 'inaccuracy', `loss ${c(0, -110).epLoss.toFixed(5)}`);
check('a loss of just over 0.10 expected points is a mistake', c(0, -111).judgment === 'mistake', `loss ${c(0, -111).epLoss.toFixed(5)}`);
check('a loss just under 0.20 expected points is a mistake', c(0, -230).judgment === 'mistake', `loss ${c(0, -230).epLoss.toFixed(5)}`);
check('a loss of just over 0.20 expected points is a blunder', c(0, -231).judgment === 'blunder', `loss ${c(0, -231).epLoss.toFixed(5)}`);
check('the engine top move is still labelled best when the eval dips a little', c(0, -22, true).judgment === 'best');
check('the accuracy of the engine top move still follows the win-percent drop', Math.abs(c(0, -55, true).accuracy - accuracyPercent(c(0, -55, true).loss)) < 1e-9);
check('a forced move with no eval drop is forced with 100 accuracy', classifyMove({ bestCp: 0, playedCp: 0, legalCount: 1 }).judgment === 'forced'
  && classifyMove({ bestCp: 0, playedCp: 0, legalCount: 1 }).accuracy === 100);
check('a forced move that allows mate is still forced', classifyMove({
  bestScore: { kind: 'cp', value: -248 }, playedScore: { kind: 'mate', value: -2 }, legalCount: 1,
}).judgment === 'forced');
check('the published expected-points cuts are 0.02, 0.05, 0.10 and 0.20',
  EP_EXCELLENT === 0.02 && EP_GOOD === 0.05 && EP_INACCURACY === 0.10 && EP_MISTAKE === 0.20 && CP_CEILING === 1000);
check('classifyByExpectedPoints agrees with the band table', classifyByExpectedPoints(0.02) === 'excellent' && classifyByExpectedPoints(0.05) === 'good' && classifyByExpectedPoints(0.10) === 'inaccuracy' && classifyByExpectedPoints(0.20) === 'mistake' && classifyByExpectedPoints(0.21) === 'blunder');
check('a book move with a small loss is labelled book', c(0, -20, false, { isBook: true }).judgment === 'book');
check('a book move with a large loss is not labelled book', c(0, -231, false, { isBook: true }).judgment === 'blunder');
check('a nearly best sacrifice in a non-winning position is brilliant', c(100, 100, true, { isSacrifice: true }).judgment === 'brilliant');
check('a sacrifice when already completely winning is not brilliant', c(800, 800, true, { isSacrifice: true }).judgment === 'best');
check('the only good move can be labelled great', c(0, 0, true, { secondScore: { kind: 'cp', value: -231 } }).judgment === 'great');

check('the Brilliant safe win-chance threshold is 45', BRILLIANT_SAFE_WP === 45);
check('a sacrifice just below the safe threshold is not brilliant', c(-65, -65, true, { isSacrifice: true }).judgment !== 'brilliant' && c(-65, -65, true, { isSacrifice: true }).winAfter < BRILLIANT_SAFE_WP);
check('a sacrifice at the safe threshold can be brilliant', c(-54, -54, true, { isSacrifice: true }).judgment === 'brilliant' && c(-54, -54, true, { isSacrifice: true }).winAfter >= BRILLIANT_SAFE_WP);
check('a recapture is not labelled great just because it is the only good move', c(0, 0, true, { secondScore: { kind: 'cp', value: -231 }, isRecapture: true }).judgment !== 'great');
check('a mate in one is not labelled great when another move is also winning', classifyMove({
  bestScore: { kind: 'mate', value: 1 }, playedScore: { kind: 'mate', value: 1 }, isBestMove: true, legalCount: 4,
  secondScore: { kind: 'cp', value: 300 },
}).judgment !== 'great');
check('a mate in one is not labelled great even when it is the only winning move', classifyMove({
  bestScore: { kind: 'mate', value: 1 }, playedScore: { kind: 'mate', value: 1 }, isBestMove: true, legalCount: 4,
  secondScore: { kind: 'cp', value: -400 },
}).judgment !== 'great');
check('the only good move is not labelled great when the side is already winning', c(400, 400, true, { secondScore: { kind: 'cp', value: 50 } }).judgment !== 'great');
check('the only legal move is forced rather than great', classifyMove({
  bestCp: 0, playedCp: 0, isBestMove: true, legalCount: 1, secondScore: { kind: 'cp', value: -400 },
}).judgment === 'forced');
check('the Miss expected-points floor is 0.05', EP_GOOD === 0.05);
{
  const src = fs.readFileSync(new URL('../src/review.js', import.meta.url), 'utf8');
  check('the Miss rule applies the expected-points floor in classifyMove', /loss\s*>=\s*EP_GOOD/.test(src));
}

// ---- Miss (requires that the opponent just went wrong) ----
check('a drop from +200 to -200 is a miss when the opponent just erred', c(200, -200, false, { opponentBlundered: true }).judgment === 'miss');
check('the same drop is a blunder when the opponent did not just err', c(200, -200).judgment === 'blunder');
check('a drop from +400 to 0 is a miss when the opponent just erred', c(400, 0, false, { opponentBlundered: true }).judgment === 'miss');
check('a modest inaccuracy that was never a winning position is not a miss', c(80, 0, false, { opponentBlundered: true }).judgment === 'inaccuracy');
check('a blunder that leaves a clearly winning position is not a miss', c(800, 100, false, { opponentBlundered: true }).judgment === 'blunder');
check('a drop from a winning move to just below +100 centipawns is a miss after an error', c(500, 99, false, { opponentBlundered: true }).judgment === 'miss');
check('a drop that stays at +100 centipawns is not a miss', c(500, 100, false, { opponentBlundered: true }).judgment !== 'miss');
check('isMissedWin requires a winning best move and a non-winning played move',
  isMissedWin(200, 0) === true && isMissedWin(199, 0) === false && isMissedWin(200, 100) === false && MISS_AFTER_CP === 100 && WIN_CP === 200);

// ---- Mates under the expected-points mapping (not Lichess MateAdvice) ----
check("Legall's 5...Bxd1, allowing mate in 2 from -248, is a blunder", classifyMove({
  bestScore: { kind: 'cp', value: -248 }, playedScore: { kind: 'mate', value: -2 }, legalCount: 4,
}).judgment === 'blunder');
check('allowing mate from a position already at the -1000 ceiling has a zero expected-points loss', classifyMove({
  bestScore: { kind: 'cp', value: -1000 }, playedScore: { kind: 'mate', value: -2 }, legalCount: 4,
}).judgment === 'best');
check('allowing mate from -800 is a small expected-points loss, not a Lichess-style mistake', classifyMove({
  bestScore: { kind: 'cp', value: -800 }, playedScore: { kind: 'mate', value: -1 }, legalCount: 4,
}).judgment === 'good');
check('the unused Lichess mate cut-offs remain 700 and 999, as documentation', MATE_MISTAKE_CP === 700 && MATE_INACCURACY_CP === 999);
check('allowing mate from -600 is an inaccuracy under expected points', classifyMove({
  bestScore: { kind: 'cp', value: -600 }, playedScore: { kind: 'mate', value: -1 }, legalCount: 4,
}).judgment === 'inaccuracy');
check('losing a mate into a score of 600 is an inaccuracy under expected points', classifyMove({
  bestScore: { kind: 'mate', value: 2 }, playedScore: { kind: 'cp', value: 600 }, legalCount: 4,
}).judgment === 'inaccuracy');
check('losing a mate into a score of 0 is a blunder, or a miss if the opponent just erred', classifyMove({
  bestScore: { kind: 'mate', value: 3 }, playedScore: { kind: 'cp', value: 0 }, legalCount: 4,
}).judgment === 'blunder' && classifyMove({
  bestScore: { kind: 'mate', value: 3 }, playedScore: { kind: 'cp', value: 0 }, legalCount: 4, opponentBlundered: true,
}).judgment === 'miss');
check('losing a mate into a score already at the ceiling has a zero expected-points loss', classifyMove({
  bestScore: { kind: 'mate', value: 2 }, playedScore: { kind: 'cp', value: 1200 }, legalCount: 4,
}).judgment === 'best');
check('a mate in 3 that becomes a mate in 5 is not flagged', classifyMove({
  bestScore: { kind: 'mate', value: 3 }, playedScore: { kind: 'mate', value: 5 }, legalCount: 4,
}).judgment === 'best' || classifyMove({
  bestScore: { kind: 'mate', value: 3 }, playedScore: { kind: 'mate', value: 5 }, legalCount: 4,
}).judgment === 'good');
check('winPercent maps a mate to the 1000-centipawn ceiling', winPercent({ kind: 'mate', value: 2 }) === winPercent(1000) && winPercent({ kind: 'mate', value: -1 }) === winPercent(-1000));
check('winPercent caps ordinary scores at 1000 centipawns', winPercent(5000) === winPercent(1000) && winPercent(-5000) === winPercent(-1000));

// ---- Margin rules (same constants as puzzle-verify.js) ----
const GAP_ONLY = [line('e7e5', 250), line('c7c5', 80)];
const ALT_ONLY = [line('e7e5', 900), line('c7c5', 550)];
const CLEAR = [line('e7e5', 500), line('c7c5', 80)];
const TOP_ONLY_WRONG = [line('d7d5', 800), line('e7e6', 200)]; // would pass if the stored move were d7d5
const MATE_UNIQUE = [line('e7e8q', 0, 'mate'), line('e7e5', 400)];
const MATE_TIE = [line('e7e8q', 1, 'mate'), line('a7a8q', 1, 'mate')];
const MATE_SLOWER = [line('e7e8q', 1, 'mate'), line('a7a8q', 2, 'mate')];

check('a unique winning move passes the margin rules', passesMarginRules(CLEAR) === true);
check('a near-tie that is not itself winning is rejected', passesMarginRules(GAP_ONLY) === false);
check('that near-tie is accepted when only the gap rule is disabled', passesMarginRules(GAP_ONLY, { gap: -1e9 }) === true);
check('that near-tie stays rejected when only the also-wins rule is disabled', passesMarginRules(GAP_ONLY, { altWin: 1e9 }) === false);
check('a second move that also wins is rejected', passesMarginRules(ALT_ONLY) === false);
check('that second win is accepted when only the also-wins rule is disabled', passesMarginRules(ALT_ONLY, { altWin: 1e9 }) === true);
check('that second win stays rejected when only the gap rule is disabled', passesMarginRules(ALT_ONLY, { gap: -1e9 }) === false);
check('a unique mate passes the margin rules', passesMarginRules(MATE_UNIQUE) === true);
check('two mates of the same length are rejected', passesMarginRules(MATE_TIE) === false);
check('a faster unique mate is accepted by the generated-puzzle margin rules', passesMarginRules(MATE_SLOWER) === true);
check('a second, slower mate is rejected for My mistakes', passesMistakeMarginRules(MATE_SLOWER) === false);
check('a unique mate still passes the My mistakes margin rules', passesMistakeMarginRules(MATE_UNIQUE) === true);
check('an empty line list is rejected', passesMarginRules([]) === false && passesMarginRules(null) === false);
check('the margin constants match the generated-puzzle rules', GAP_CP === 200 && ALT_WIN_CP === 300 && ALT_MARGIN_CP === 400);

// ---- User vs bot ----
check('in a bot game only the player colour counts as the user', isUserMove('bot', 'w', 'w') && !isUserMove('bot', 'w', 'b') && isUserMove('bot', 'b', 'b') && !isUserMove('bot', 'b', 'w'));
check('in a two-player or analysis game both colours count as the user', isUserMove('local', 'w', 'b') && isUserMove('analysis', 'w', 'w'));

// ---- buildReview extracts mistakes only when margins and user-side pass ----
function ev(linesW, turn) {
  return { turn, lines: linesW };
}

function sampleEvals(blackLines, afterBlack) {
  // 1. e4 a6 — Black's first move is the candidate mistake.
  return [
    ev([line('e2e4', 20), line('d2d4', 10)], 'w'),
    ev(blackLines, 'b'),
    ev(afterBlack || [line('d2d4', 400), line('e2e4', 300)], 'w'),
  ];
}

function reviewOf(blackLines, afterBlack, extra = {}) {
  return buildReview({
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    uci: ['e2e4', 'a7a6'],
    mode: extra.mode || 'local',
    playerColor: extra.playerColor || 'w',
    depth: REVIEW_DEPTH,
    name: extra.name || 'Test game',
    evals: sampleEvals(blackLines, afterBlack),
  });
}

{
  const quiet = reviewOf([line('e7e5', -20), line('c7c5', -30)], [line('d2d4', 25)]);
  check('White\'s first move, a tiny concession, is book, best, excellent or good', ['book', 'best', 'excellent', 'good'].includes(quiet.moves[0].judgment), quiet.moves[0].judgment);
  const r = reviewOf(CLEAR, [line('d2d4', 400)]);
  check('Black\'s deviation from a unique +500 move is a miss or a blunder', r.moves[1].judgment === 'miss' || r.moves[1].judgment === 'blunder', r.moves[1].judgment);
  check('a unique winning alternative for the user becomes a personal puzzle', r.mistakes.length === 1 && r.mistakes[0].solution[0] === 'e7e5', JSON.stringify(r.mistakes));
  check('the personal puzzle records the move that was actually played', r.mistakes[0] && r.mistakes[0].playedUci === 'a7a6');
}

{
  const r = reviewOf(GAP_ONLY, [line('d2d4', 400)]);
  check('a near-tie winning alternative is not turned into a puzzle', r.mistakes.length === 0, `got ${r.mistakes.length}`);
  check('the played move is still classified when the margin fails', r.moves[1].judgment === 'miss' || r.moves[1].judgment === 'blunder' || r.moves[1].judgment === 'mistake', r.moves[1].judgment);
}

{
  const r = reviewOf(ALT_ONLY, [line('d2d4', 400)]);
  check('a second move that also wins is not turned into a puzzle', r.mistakes.length === 0, `got ${r.mistakes.length}`);
}

{
  const r = reviewOf(CLEAR, [line('d2d4', 400)], { mode: 'bot', playerColor: 'w' });
  check('a bot mistake is not turned into a personal puzzle for the user', r.mistakes.length === 0, `got ${r.mistakes.length} judgment=${r.moves[1].judgment} isPlayer=${r.moves[1].isPlayer}`);
  check('the bot move is marked as not the user\'s', r.moves[1].isPlayer === false);
}

{
  const r = reviewOf(CLEAR, [line('d2d4', 400)], { mode: 'bot', playerColor: 'b' });
  check('the same mistake is stored when the user played Black against the bot', r.mistakes.length === 1);
}

{
  const r = reviewOf(CLEAR, [line('d2d4', 400)]);
  check('both sides receive an accuracy score', r.accuracy.w != null && r.accuracy.b != null && r.accuracy.player != null);
  check('the review records the scheme version and depth', r.version === SCHEME_VERSION && r.scheme === SCHEME_ID && SCHEME_ID === 'ornate-review-v8' && r.depth === REVIEW_DEPTH);
  check('each move stores a principal variation when the engine sent one', r.moves.every((m) => m.bestLine && Array.isArray(m.bestLine.uci)));
  check('the evaluation graph has one point per position', r.positions.length === 3 && typeof r.positions[0].winPercent === 'number');
  check('every judgment name is one of the documented labels', r.moves.every((m) => JUDGMENTS.includes(m.judgment)));
}

// Fingerprints are stable and change when the game or depth changes.
const fp1 = reviewFingerprint('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5'], 12);
const fp2 = reviewFingerprint('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5'], 12);
const fp3 = reviewFingerprint('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'c7c5'], 12);
const fp4 = reviewFingerprint('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5'], 14);
check('the review fingerprint is stable for the same game and depth', fp1 === fp2 && fp1.length > 0);
check('the review fingerprint changes when the moves or the depth change', fp1 !== fp3 && fp1 !== fp4);

// ---- Storage: cache, mistakes, remove, solved, guards ----
{
  const mem = new MemoryStorage();
  const store = createReviewStore({ backend: mem });
  const r = reviewOf(CLEAR, [line('d2d4', 400)], { name: 'Cached game' });
  check('a review can be saved and loaded by its fingerprint', store.saveReview(r) === true && !!store.loadReview(r.startFen, r.uci, r.depth));
  const loaded = store.loadReview(r.startFen, r.uci, r.depth);
  check('the cached review keeps accuracy and mistake counts', loaded && loaded.mistakes.length === 1 && typeof loaded.accuracy.w === 'number');
  const puzzles = store.listMistakes();
  check('saving a review adds qualifying positions to My mistakes', puzzles.length === 1 && puzzles[0].solution[0] === 'e7e5');
  const id = puzzles[0].id;
  store.markMistake(id, { solved: true, attempts: 2, usedHint: true });
  const marked = store.getMistake(id);
  check('a personal puzzle can be marked solved', marked && marked.solved === true && marked.attempts === 2 && marked.usedHint === true);
  store.saveReview(r);
  check('saving the same review again does not duplicate the puzzle', store.listMistakes().length === 1);
  check('a personal puzzle can be removed', store.removeMistake(id) === true && store.listMistakes().length === 0);
  check('a missing review returns null', store.loadReview(r.startFen, ['d2d4'], r.depth) === null);
}

{
  // A backend that throws on write must not throw out of the store.
  const throwing = {
    data: new Map(),
    getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
    setItem() { throw new Error('quota'); },
    removeItem(k) { this.data.delete(k); },
  };
  const store = createReviewStore({ backend: throwing });
  let threw = false;
  try { store.saveReview(reviewOf(CLEAR, [line('d2d4', 400)])); } catch { threw = true; }
  check('a blocked or full store is guarded and does not throw', threw === false);
}

// ---- Game accuracy aggregation (Lichess volatility + harmonic mean) ----
{
  const sd = standardDeviation([46, 69, 32, 60, 52, 41]);
  check('the population standard deviation matches the scalalib test value', sd != null && Math.abs(sd - 12.15) < 0.01);
  check('the harmonic mean uses max(1, value)', Math.abs(harmonicMean([100, 50]) - 2 / (1 / 100 + 1 / 50)) < 1e-12);
  check('the weighted mean is the value-weight product over the total weight', Math.abs(weightedMean([[10, 1], [30, 3]]) - 25) < 1e-12);
  // A two-move (three-position) sequence: window size is 2, one move each.
  const acc = gameAccuracy('w', [50, 40, 40]);
  const whiteMove = accuracyFromWinPercents(50, 40);
  const blackMove = accuracyFromWinPercents(40, 40); // 100, Black did not lose White's chances
  check('game accuracy blends the weighted and harmonic means for each side',
    acc.w != null && acc.b != null && Math.abs(acc.w - whiteMove) < 1e-9 && Math.abs(acc.b - 100) < 1e-9,
    JSON.stringify(acc));
}

// ---- inspectMistakePuzzle / verifyMistakePuzzle (N1) ----
{
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  check('a legal stored mistake is accepted by the inspector', inspectMistakePuzzle({ fen: start, solution: ['e2e4'] }).ok === true);
  check('a garbage FEN is labelled invalid and is not thrown', inspectMistakePuzzle({ fen: 'not-a-fen', solution: ['e2e4'] }).reason === 'invalid-fen' && inspectMistakePuzzle({ fen: 'not-a-fen', solution: ['e2e4'] }).ok === false);
  check('an illegal solution is labelled and is not thrown', inspectMistakePuzzle({ fen: start, solution: ['e2e5'] }).reason === 'illegal-solution');
  const unique = { fen: start, solution: ['e2e4'] };
  const okEngine = { async analyse() { return [{ move: 'e2e4', kind: 'cp', value: 500 }, { move: 'd2d4', kind: 'cp', value: 80 }]; } };
  const nonUnique = { async analyse() { return [{ move: 'e2e4', kind: 'cp', value: 40 }, { move: 'd2d4', kind: 'cp', value: 30 }]; } };
  const twoMates = { async analyse() { return [{ move: 'e7e8q', kind: 'mate', value: 1 }, { move: 'a7a8q', kind: 'mate', value: 2 }]; } };
  const mateFen = { fen: '6k1/4P3/8/8/8/8/8/4K3 w - - 0 1', solution: ['e7e8q'] };
  check('an inspect of the promotion mate FEN is legal or reports a precise reason', ['', 'invalid-fen', 'illegal-solution'].includes(inspectMistakePuzzle(mateFen).reason || '') || inspectMistakePuzzle(mateFen).ok === true);
}
{
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const unique = { fen: start, solution: ['e2e4'] };
  const okEngine = { async analyse() { return [{ move: 'e2e4', kind: 'cp', value: 500 }, { move: 'd2d4', kind: 'cp', value: 80 }]; } };
  const nonUnique = { async analyse() { return [{ move: 'e2e4', kind: 'cp', value: 40 }, { move: 'd2d4', kind: 'cp', value: 30 }]; } };
  const twoMates = { async analyse() { return [{ move: 'e7e8q', kind: 'mate', value: 1 }, { move: 'a7a8q', kind: 'mate', value: 2 }]; } };
  const r1 = await verifyMistakePuzzle(unique, okEngine);
  check('a unique winning first move is accepted at the confirmation depth', r1.ok === true, JSON.stringify(r1));
  const r2 = await verifyMistakePuzzle(unique, nonUnique);
  check('a non-unique stored move is rejected by the confirmation pass', r2.ok === false && r2.reason === 'not-unique' && r2.legal === true);
  const r3 = await verifyMistakePuzzle({ fen: start, solution: ['e2e5'] }, okEngine);
  check('an illegal stored solution is rejected without calling a successful verify', r3.ok === false && r3.reason === 'illegal-solution');
  const r4 = await verifyMistakePuzzle({ fen: '6k1/4P3/8/8/8/8/8/4K3 w - - 0 1', solution: ['e7e8q'] }, twoMates);
  check('two mating first moves are rejected even if one is slower', r4.ok === false && (r4.reason === 'not-unique' || r4.reason === 'illegal-solution'), JSON.stringify(r4));
}

// ---- Fixtures from ReviewBot's four games (full Stockfish 19 at depth 18) ----
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/lichess-review-games.json');
  const games = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const acc1 = (v) => Math.round(v * 10) / 10;
  const amateur = buildReview({ startFen: games.amateur.startFen, uci: games.amateur.uci, evals: games.amateur.evals, mode: 'local', name: 'amateur' });
  const legal = buildReview({ startFen: games.legal.startFen, uci: games.legal.uci, evals: games.legal.evals, mode: 'local', name: 'legal' });
  const opera = buildReview({ startFen: games.opera.startFen, uci: games.opera.uci, evals: games.opera.evals, mode: 'local', name: 'opera' });
  const stale = buildReview({ startFen: games.stalemate.startFen, uci: games.stalemate.uci, evals: games.stalemate.evals, mode: 'local', name: 'stalemate' });
  check('amateur White accuracy matches the Lichess method at 44.4', acc1(amateur.accuracy.w) === 44.4, String(acc1(amateur.accuracy.w)));
  check('amateur Black accuracy matches the Lichess method at 82.7', acc1(amateur.accuracy.b) === 82.7, String(acc1(amateur.accuracy.b)));
  check('Legall White accuracy matches the Lichess method at 96.2', acc1(legal.accuracy.w) === 96.2, String(acc1(legal.accuracy.w)));
  check('Legall Black accuracy matches the Lichess method at 54.9', acc1(legal.accuracy.b) === 54.9, String(acc1(legal.accuracy.b)));
  check('Opera White accuracy matches the Lichess method at 97.0', acc1(opera.accuracy.w) === 97.0, String(acc1(opera.accuracy.w)));
  check('Opera Black accuracy matches the Lichess method at 77.9', acc1(opera.accuracy.b) === 77.9, String(acc1(opera.accuracy.b)));
  const bxd1 = legal.moves.find((m) => m.san === 'Bxd1');
  check("Legall's 5...Bxd1 is a blunder in the depth-18 fixture", bxd1 && bxd1.judgment === 'blunder' && bxd1.loss > 15 && bxd1.loss < 30);
  const nxe5 = amateur.moves.find((m) => m.san === 'Nxe5');
  const nxf7 = amateur.moves.find((m) => m.san === 'Nxf7');
  const nd4 = amateur.moves.find((m) => m.san === 'Nd4');
  check("the amateur game's 3...Nd4 is a mistake", nd4 && nd4.judgment === 'mistake');
  check("the amateur game's 4.Nxe5 is a blunder", nxe5 && nxe5.judgment === 'blunder');
  check("the amateur game's 5.Nxf7 is a blunder", nxf7 && nxf7.judgment === 'blunder');
  const b5 = opera.moves.find((m) => m.san === 'b5' && m.ply === 18);
  check("the Opera Game's 9...b5 is a mistake", b5 && b5.judgment === 'mistake' && b5.loss >= 10 && b5.loss < 15);
  const qe6 = stale.moves.find((m) => m.san === 'Qe6');
  check("Loyd's stalemating 10.Qe6 is a blunder or a miss", qe6 && (qe6.judgment === 'blunder' || qe6.judgment === 'miss'), qe6 && qe6.judgment);
  const nxe5Legal = legal.moves.find((m) => m.san === 'Nxe5');
  check("Legall's 5.Nxe5 can be labelled brilliant as a piece sacrifice", nxe5Legal && (nxe5Legal.judgment === 'brilliant' || nxe5Legal.judgment === 'best' || nxe5Legal.judgment === 'great'), nxe5Legal && nxe5Legal.judgment);
  check('the old 30-point band would have called Bxd1 a mistake', bxd1 && bxd1.loss < 30);
  check('stalemate White accuracy is 5.9 to one decimal place', acc1(stale.accuracy.w) === 5.9, String(acc1(stale.accuracy.w)));
  check('stalemate Black accuracy is 5.3 to one decimal place', acc1(stale.accuracy.b) === 5.3, String(acc1(stale.accuracy.b)));
}


function playSans(sans) {
  let pos = Position.fromFen(START_FEN);
  let last = null, before = pos;
  for (const san of sans) {
    const m = pos.parseSan(san);
    if (!m) throw new Error('Cannot play ' + san + ' in ' + pos.toFen());
    before = pos;
    last = m;
    pos = pos.makeMove(m);
  }
  return { before, after: pos, move: last };
}
function sansOf(pgn) {
  return pgn.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter((tok) => tok && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok));
}
function playUpto(pgn, n) {
  return playSans(sansOf(pgn).slice(0, n));
}

const FRENCH_PGN = '1.e4 e6 2.d4 d5 3.exd5 exd5 4.Nf3 Nf6 5.Bd3 Bd6 6.O-O O-O 7.Bg5 Bg4 8.Nbd2 Nbd7 9.c3 c6 10.Qc2 Qc7 11.Rae1 Rae8';
const OPERA_PGN = '1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5';
const FISCHER_PGN = '1.Nf3 Nf6 2.c4 g6 3.Nc3 Bg7 4.d4 O-O 5.Bf4 d5 6.Qb3 dxc4 7.Qxc4 c6 8.e4 Nbd7 9.Rd1 Nb6 10.Qc5 Bg4 11.Bg5 Na4 12.Qa3 Nxc3 13.bxc3 Nxe4 14.Bxe7 Qb6 15.Bc4 Nxc3 16.Bc5 Rfe8+ 17.Kf1 Be6';
const KT_PGN = '1.e4 d6 2.d4 Nf6 3.Nc3 g6 4.Be3 Bg7 5.Qd2 c6 6.f3 b5 7.Nge2 Nbd7 8.Bh6 Bxh6 9.Qxh6 Bb7 10.a3 e5 11.O-O-O Qe7 12.Kb1 a6 13.Nc1 O-O-O 14.Nb3 exd4 15.Rxd4 c5 16.Rd1 Nb6 17.g3 Kb8 18.Na5 Ba8 19.Bh3 d5 20.Qf4+ Ka7 21.Rhe1 d4 22.Nd5 Nbxd5 23.exd5 Qd6 24.Rxd4';
const RUY_EX_PGN = '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6';

const french = playUpto(FRENCH_PGN, 22);
check("11...Rae8 in the Exchange French is not a real sacrifice", isPieceSacrifice(french.before, french.after, french.move) === false);
check('the sacrifice threshold is an exchange (200 centipawns)', SACRIFICE_CP === 200);
const operaNx = playUpto(OPERA_PGN, 19);
check("the Opera Game's 10.Nxb5 is a real sacrifice", isPieceSacrifice(operaNx.before, operaNx.after, operaNx.move) === true);
const fischerBe6 = playUpto(FISCHER_PGN, 34);
const fischerHangAfter = hangingExchanges(fischerBe6.after, fischerBe6.before.turn);
const fischerIsSac = isPieceSacrifice(fischerBe6.before, fischerBe6.after, fischerBe6.move);
check("Fischer's 17...Be6 is a sacrifice, because the hanging queen could have been saved", fischerIsSac === true, 'got ' + fischerIsSac);
check("Fischer's 17...Be6 has a saving alternative for the queen", hasSavingAlternative(fischerBe6.before, fischerBe6.move, fischerHangAfter) === true);
{
  const queenSq = fischerHangAfter.find((h) => (fischerBe6.after.pieceAt(h.sq) || {}).type === 'q');
  const alts = sacrificeAlternatives(fischerBe6.before, fischerBe6.move, fischerHangAfter);
  const qc7 = fischerBe6.before.parseSan('Qc7');
  check('a queen move such as Qc7 is in the candidate set for 17...Be6', !!(queenSq && qc7 && alts.some((m) => m.from === qc7.from && m.to === qc7.to)));
}
const ktRxd4 = playUpto(KT_PGN, 47);
check("Kasparov-Topalov 24.Rxd4 is a real sacrifice", isPieceSacrifice(ktRxd4.before, ktRxd4.after, ktRxd4.move) === true);
check("Kasparov-Topalov 24.Rxd4 is a landing-square sacrifice", isLandingSacrifice(ktRxd4.after, ktRxd4.move) === true);
const ruyEx = playUpto(RUY_EX_PGN, 7);
check('a bishop-for-knight recapture is not a real sacrifice', isPieceSacrifice(ruyEx.before, ruyEx.after, ruyEx.move) === false);
const immortalPgn = '1.e4 e5 2.f4 exf4 3.Bc4 Qh4+ 4.Kf1 b5 5.Bxb5 Nf6 6.Nf3 Qh6 7.d3 Nh5 8.Nh4 Qg5 9.Nf5 c6 10.g4 Nf6 11.Rg1';
const rg1 = playUpto(immortalPgn, 21);
check("Immortal 11.Rg1 is a sacrifice, because the hanging bishop on b5 could have been saved", isPieceSacrifice(rg1.before, rg1.after, rg1.move) === true);
{
  const hang = hangingExchanges(rg1.after, rg1.before.turn);
  check('Immortal 11.Rg1 has a saving alternative for the bishop', hasSavingAlternative(rg1.before, rg1.move, hang) === true);
  const ba4 = rg1.before.parseSan('Ba4');
  const alts = sacrificeAlternatives(rg1.before, rg1.move, hang);
  check('Ba4 is a candidate that saves the hanging bishop in the Immortal Game', !!(ba4 && alts.some((m) => m.from === ba4.from && m.to === ba4.to)));
}
let hangPawnBefore = Position.fromFen('8/8/3p4/4P3/8/8/8/4K2k w - - 0 1');
const hangPawnMove = hangPawnBefore.parseSan('Kd2') || hangPawnBefore.parseSan('Kd1') || hangPawnBefore.parseUci('e1d2');
const hangPawnAfter = hangPawnBefore.makeMove(hangPawnMove);
check('a hanging pawn (under 200 centipawns) is not a piece sacrifice', isPieceSacrifice(hangPawnBefore, hangPawnAfter, hangPawnMove) === false);
check('the Opera Game landing-square sacrifice rule is used for 10.Nxb5', isLandingSacrifice(operaNx.after, operaNx.move) === true);
{
  const lostBefore = Position.fromFen('4k3/4r3/8/8/8/8/4Q3/4K3 w - - 0 1');
  const lostMove = lostBefore.parseSan('Kd1');
  const lostAfter = lostBefore.makeMove(lostMove);
  const lostHang = hangingExchanges(lostAfter, 'w');
  check('a pinned hanging queen with no saving alternative is not a sacrifice', isPieceSacrifice(lostBefore, lostAfter, lostMove) === false);
  check('the lost-anyway position has hanging material and no saving alternative', lostHang.length > 0 && hasSavingAlternative(lostBefore, lostMove, lostHang) === false);
}
{
  const src = fs.readFileSync(new URL('../src/review.js', import.meta.url), 'utf8');
  check('the landing-square pawn-sacrifice rule is present', /landingNet >= 100/.test(src) && /isLandingSacrifice/.test(src) && /isLandingSacrifice\(afterPos, move\)/.test(src));
  check('a hang below the sacrifice threshold is rejected', /hang < SACRIFICE_CP/.test(src));
  check('already-hanging material uses the saving-alternative check', /hangBefore >= SACRIFICE_CP[\s\S]{0,200}hasSavingAlternative\(before, move/.test(src));
}

const epFen = 'rnbqkbnr/pppp1ppp/8/4p3/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2';
const epParts = fenWithNullMove(epFen).split(' ');
check('fenWithNullMove flips the side to move', epParts[1] === 'w');
check('fenWithNullMove clears the en passant square', epParts[3] === '-');
check('fenWithNullMove keeps the rest of the FEN', epParts[0] === epFen.split(' ')[0] && epParts[2] === 'KQkq');

const ruyReview = buildReview({
  startFen: START_FEN,
  uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4'],
  evals: [
    ev([{ move: 'e2e4', kind: 'cp', value: 30 }, { move: 'd2d4', kind: 'cp', value: 25 }], 'w'),
    ev([{ move: 'e7e5', kind: 'cp', value: 28 }, { move: 'c7c5', kind: 'cp', value: 20 }], 'b'),
    ev([{ move: 'g1f3', kind: 'cp', value: 40 }, { move: 'b1c3', kind: 'cp', value: 30 }], 'w'),
    ev([{ move: 'b8c6', kind: 'cp', value: 30 }, { move: 'd7d6', kind: 'cp', value: 20 }], 'b'),
    ev([{ move: 'f1b5', kind: 'cp', value: 40 }, { move: 'd2d4', kind: 'cp', value: 30 }], 'w'),
    ev([{ move: 'a7a6', kind: 'cp', value: 30 }, { move: 'g8f6', kind: 'cp', value: 25 }], 'b'),
    ev([{ move: 'b5a4', kind: 'cp', value: 35 }, { move: 'b5c6', kind: 'cp', value: 20 }], 'w'),
    ev([{ move: 'g8f6', kind: 'cp', value: 30 }, { move: 'd7d6', kind: 'cp', value: 20 }], 'b'),
  ],
  mode: 'local',
  depth: REVIEW_DEPTH,
  name: 'Ruy',
});
check('1.e4 has no threat arrow', !ruyReview.moves[0].threatUci, ruyReview.moves[0].threatUci);
check('3.Bb5 has no threat arrow', !ruyReview.moves[4].threatUci, ruyReview.moves[4].threatUci);
check('4.Ba4 has no threat arrow', !ruyReview.moves[6].threatUci, ruyReview.moves[6].threatUci);
const afterE4 = Position.fromFen(START_FEN).makeMove(Position.fromFen(START_FEN).parseUci('e2e4'));
check('a quiet reply after 1.e4 is not a meaningful threat', threatIsMeaningful(afterE4, { move: 'e7e5', kind: 'cp', value: 30 }) === false);
check('a quiet check or idea is not enough for a threat arrow', threatIsMeaningful(afterE4, { move: 'd7d5', kind: 'cp', value: 20 }) === false);
check('a non-capturing move with a large evaluation is not a threat arrow', threatIsMeaningful(afterE4, { move: 'e7e5', kind: 'cp', value: 900 }) === false);

// Real engine output recorded by tools/record-review-fixture.mjs (bundled
// Stockfish at REVIEW_DEPTH, MultiPV 2). Earlier versions of this test used
// hand-written evaluations that called 7...g5 a blunder; Stockfish and the
// lichess cloud evaluation both rate 7...g5 as the best or a near-best move.
const ITALIAN_FX = JSON.parse(fs.readFileSync(new URL('./fixtures/italian-review-evals.json', import.meta.url), 'utf8'));
{
  const g = ITALIAN_FX.games.g5;
  const r = buildReview({ startFen: g.startFen, uci: g.uci, evals: g.evals, mode: 'local', depth: REVIEW_DEPTH, name: 'Italian g5' });
  const g5 = r.moves[13], nxg5 = r.moves[14];
  check('regression: in the reported game 7...g5 is not a Mistake or a Blunder', g5.uci === 'g7g5' && !['mistake', 'blunder', 'miss'].includes(g5.judgment), `${g5.san} ${g5.judgment} ${g5.evalAfter.whiteCp}`);
  check('regression: 7...g5 is rated Best, Excellent or Good', ['best', 'excellent', 'good'].includes(g5.judgment), g5.judgment);
  check('regression: 7...g5 has no refutation arrow', !g5.threatUci, String(g5.threatUci));
  check('regression: after 7...g5 the evaluation stays near equal', Math.abs(g5.evalAfter.whiteCp) < 100, String(g5.evalAfter.whiteCp));
  check('regression: 8.Nxg5 is not Best or Excellent', nxg5.uci === 'f3g5' && !['best', 'excellent', 'great', 'brilliant'].includes(nxg5.judgment), `${nxg5.san} ${nxg5.judgment}`);
  check('regression: the engine prefers 8.Bg3 to 8.Nxg5', nxg5.bestUci === 'h4g3', String(nxg5.bestUci));
  check('regression: 8.Nxg5 leaves Black better', nxg5.evalAfter.whiteCp < -50, String(nxg5.evalAfter.whiteCp));
}
const italianG5Uci = ITALIAN_FX.games.castleMiss.uci;
const italianG5Evals = ITALIAN_FX.games.castleMiss.evals;
const italianG5 = buildReview({
  startFen: START_FEN, uci: italianG5Uci, evals: italianG5Evals, mode: 'local', depth: REVIEW_DEPTH, name: 'Italian O-O h5',
});
check('8.O-O, leaving the h4 bishop to ...gxh4, is a Blunder', italianG5.moves[14].uci === 'e1g1' && italianG5.moves[14].judgment === 'blunder', italianG5.moves[14].judgment);
check('8.O-O shows ...gxh4 as the red refutation', italianG5.moves[14].threatUci === 'g5h4', String(italianG5.moves[14].threatUci));
const g5Move = italianG5.moves.find((m) => m.uci === 'h6h5');
check("8...h5, missing ...gxh4, is a flagged move", !!(g5Move && ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(g5Move.judgment)), g5Move && g5Move.judgment);
check("8...h5 is a Miss because White's previous move was a blunder", g5Move && g5Move.judgment === 'miss', g5Move && g5Move.judgment);
check("8...h5 shows a red refutation arrow for Nxg5", !!(g5Move && g5Move.threatUci === 'f3g5'), g5Move && g5Move.threatUci);
check('8...h5 suggests ...gxh4', g5Move && g5Move.suggestionUci === 'g5h4', g5Move && String(g5Move.suggestionUci));
check('9.Nxg5 is the best move', italianG5.moves[16].judgment === 'best', italianG5.moves[16].judgment);
check('8...h5 is stored as a personal puzzle with ...gxh4 as the solution', italianG5.mistakes.length === 1 && italianG5.mistakes[0].solution[0] === 'g5h4', JSON.stringify(italianG5.mistakes.map((m) => m.solution)));
{
  const replayedG5 = replayGame(START_FEN, italianG5Uci.slice(0, 16));
  const afterG5 = replayedG5.positions[16];
  const playedG5 = replayedG5.positions[15].parseUci('h6h5');
  check("Nxg5 wins only a pawn by exchange, so the strict threat rule would hide it", threatIsMeaningful(afterG5, { move: 'f3g5', kind: 'cp', value: 550 }, playedG5) === false);
  const arrows = reviewArrowsForMove(g5Move, afterG5);
  const red = arrows.find((a) => a.kind === 'threat');
  const files = 'abcdefgh';
  const name = (sq) => files[sq & 7] + (1 + (sq >> 3));
  check('the 8...h5 threat arrow runs from f3 to g5', !!(red && name(red.from) === 'f3' && name(red.to) === 'g5'), red && (name(red.from) + name(red.to)));
  check("the 8...h5 refutation is marked as a knight", !!(red && red.piece === 'n'), red && String(red.piece));
  const g5Geo = engineArrowGeometry(red.from, red.to, 'w', { piece: red.piece });
  check('the Nxg5 review arrow path has a corner point', g5Geo.knight === true && g5Geo.points.length === 3, g5Geo && g5Geo.d);
  const g5Flip = engineArrowGeometry(red.from, red.to, 'b', { piece: red.piece });
  check('the Nxg5 review arrow stays L-shaped on a flipped board', g5Flip.knight === true && g5Flip.points.length === 3 && g5Flip.d !== g5Geo.d);
  const suggestArr = arrows.find((a) => a.kind === 'suggest');
  if (suggestArr) {
    const sg = engineArrowGeometry(suggestArr.from, suggestArr.to, 'w', { piece: suggestArr.piece });
    check('a non-knight suggestion arrow is drawn straight', sg.knight === false && sg.points.length === 2, sg.d);
  }
}

const ktBxh6 = playUpto(KT_PGN, 16);
const qxH6 = ktBxh6.after.parseSan('Qxh6') || ktBxh6.after.parseUci('d2h6');
check('after 8...Bxh6 the recapture Qxh6 is an equal trade, not a threat',
  qxH6 && threatIsMeaningful(ktBxh6.after, { move: ktBxh6.after.toUci ? ktBxh6.after.toUci(qxH6) : (['a','b','c','d','e','f','g','h'][qxH6.from & 7] + (1 + (qxH6.from >> 3)) + ['a','b','c','d','e','f','g','h'][qxH6.to & 7] + (1 + (qxH6.to >> 3))), kind: 'cp', value: 50 }, ktBxh6.move) === false);
const qgdPgn = '1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Bg5 Be7 5.e3 O-O 6.Nf3 Nbd7 7.Rc1 c6 8.Bd3 dxc4 9.Bxc4 Nd5 10.Bxe7 Qxe7 11.O-O Nxc3 12.Rxc3 e5 13.Qc2 exd4 14.Nxd4 Nf6 15.Bb3 Rd8 16.Rd1 Bg4 17.f3 Be6 18.Bxe6 Qxe6 19.Qb3 Qxb3';
const qxb3 = playUpto(qgdPgn, 38);
const axb3 = qxb3.after.parseSan('axb3') || qxb3.after.parseUci('a2b3');
function uciOf(pos, m) {
  const files = 'abcdefgh';
  return files[m.from & 7] + (1 + (m.from >> 3)) + files[m.to & 7] + (1 + (m.to >> 3)) + (m.promotion || '');
}
check('after 19...Qxb3 the recapture axb3 is an equal trade, not a threat',
  axb3 && threatIsMeaningful(qxb3.after, { move: uciOf(qxb3.after, axb3), kind: 'cp', value: 0 }, qxb3.move) === false);
check('an equal-trade recapture nets to less than an exchange',
  qxH6 && threatExchangeGain(ktBxh6.after, qxH6, ktBxh6.move) < SACRIFICE_CP);

// Mate-arrow limits: a forced long mate is hidden; a short mate, or a long mate with a choice, is shown.
const forcedLong = Position.fromFen('k7/8/1KQ5/8/8/8/8/8 b - - 0 1');
const longLegal = forcedLong.legalMoves();
check('the mate-threat cap is 3 moves', MATE_THREAT_MAX === 3);
if (longLegal.length === 1) {
  const only = longLegal[0];
  check('a forced mate longer than 3 is not shown as a threat arrow',
    threatIsMeaningful(forcedLong, { move: uciOf(forcedLong, only), kind: 'mate', value: 8 }) === false);
  check('a forced mate in 2 is still shown as a threat arrow',
    threatIsMeaningful(forcedLong, { move: uciOf(forcedLong, only), kind: 'mate', value: 2 }) === true);
} else {
  check('the long-mate fixture has exactly one legal move', false, 'got ' + longLegal.length);
}
const unforced = Position.fromFen('k7/8/2Q5/1K6/8/8/8/8 b - - 0 1');
const unforcedMoves = unforced.legalMoves();
if (unforcedMoves.length > 1) {
  const m0 = unforcedMoves[0];
  check('a long mate is shown as a threat when the side to move has a choice',
    threatIsMeaningful(unforced, { move: uciOf(unforced, m0), kind: 'mate', value: 8 }) === true);
} else {
  check('the unforced-mate fixture has more than one legal move', false, 'got ' + unforcedMoves.length);
}

check('a mid-line centipawn eval stays at the root score', lineEvalAtStep({ eval: { kind: 'cp', value: 80 }, uci: ['e2e4', 'e7e5'] }, 'w', 2) === 80);
check('a mate score counts down after the first ply when the starting side is mating', lineEvalAtStep({ eval: { kind: 'mate', value: 3 } }, 'w', 1) === lineEvalAtStep({ eval: { kind: 'mate', value: 2 } }, 'w', 0));
check('a mate score is unchanged on the even ply after the mating side has just moved', lineEvalAtStep({ eval: { kind: 'mate', value: 3 } }, 'w', 2) === lineEvalAtStep({ eval: { kind: 'mate', value: 2 } }, 'w', 0));
check('a negative mate score counts down after the mating side moves', lineEvalAtStep({ eval: { kind: 'mate', value: -3 } }, 'w', 1) === lineEvalAtStep({ eval: { kind: 'mate', value: -3 } }, 'w', 0) && lineEvalAtStep({ eval: { kind: 'mate', value: -3 } }, 'w', 2) === lineEvalAtStep({ eval: { kind: 'mate', value: -2 } }, 'w', 0));


console.log(`\nReview tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
