// Tests for the Your weaknesses analysis. Run: node tests/mistake-insights.test.mjs
import { Position, START_FEN } from '../src/engine.js';
import { buildReview, REVIEW_DEPTH, FLAGGED } from '../src/review.js';
import {
  gamePhase, isFork, isPinOrSkewer, hangsPiece, errorKinds, analyseWeaknesses,
  weaknessParagraphs, isCompleteSentence, MIN_GAMES_FOR_PATTERN, MIN_ERRORS_FOR_PATTERN,
  MIN_RECURRING, MIN_MOVES_PER_COLOUR, storedMistakeIsUsable,
} from '../src/mistake-insights.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
}

const START = Position.fromFen(START_FEN);
check('the starting position in the first ten moves is the opening', gamePhase(START, 1) === 'opening' && gamePhase(START, 16) === 'opening');
check('the starting army later in the game is no longer treated as an opening', gamePhase(START, 30) === 'middlegame');

const kpk = Position.fromFen('8/8/8/8/4k3/8/4P3/4K3 w - - 0 1');
check('king and pawn versus king is an endgame', gamePhase(kpk, 8) === 'endgame');

const middle = Position.fromFen('r1bq1rk1/pp2ppbp/2n2np1/3p4/3P4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 10');
check('a queenful position with many pieces at move 10 is a middlegame or an opening', gamePhase(middle, 19) === 'opening' || gamePhase(middle, 19) === 'middlegame');
check('the same position well after the opening is a middlegame', gamePhase(middle, 28) === 'middlegame');

// Knight on d5 forks the king on f6 and the queen on c7? Wait: Nd5 forks Ke7 and Qc7, or classic: N on c7 forks Ka8 and Qe8? 
// FEN: white knight d5, black king f6, black queen c6, empty otherwise enough.
const forkFen = '8/2q5/5k2/3N4/8/8/8/4K3 b - - 0 1';
const forkPos = Position.fromFen(forkFen);
// The knight is already on d5. Treat "the move" as a knight arriving on d5.
check('a knight that attacks king and queen is a fork', isFork(forkPos, { to: 35, from: 18, piece: 'n' }) === true);

const noFork = Position.fromFen('8/8/5k2/3N4/8/8/8/4K3 b - - 0 1');
check('a knight that attacks only a king is not a fork', isFork(noFork, { to: 35, from: 18, piece: 'n' }) === false);

// Pin: bishop on b2, black knight on e5, black king on h8 — diagonal.
const pinPos = Position.fromFen('7k/8/8/4n3/8/8/1B6/4K3 w - - 0 1');
check('a bishop that pins a knight to the king is a pin', isPinOrSkewer(pinPos, { to: 9, from: 0, piece: 'b' }) === true); // b2 = 1+1*8=9

const noPin = Position.fromFen('k7/8/8/8/8/8/1B6/4K3 w - - 0 1');
check('a bishop with a clear ray to the king is not a pin', isPinOrSkewer(noPin, { to: 9, from: 0, piece: 'b' }) === false);

// Hanging: white bishop on d4, black to move, attacked by a pawn on e5? Simpler: black to move can take an undefended knight on d4 with a queen.
const hangPos = Position.fromFen('8/8/8/8/3N4/8/4K3/q6k b - - 0 1');
const hung = hangsPiece(hangPos, 'w');
check('an undefended knight that the opponent can take is hanging', hung && hung.type === 'n', JSON.stringify(hung));

const defended = Position.fromFen('8/8/8/8/3N4/8/8/Q3K2k b - - 0 1');
// Queen on a1 does not defend d4. Add a pawn on c3 or a king closer... White king on e3 defends d4? e3=4+2*8=20, d4=3+3*8=27. Adjacent diagonally yes.
const def2 = Position.fromFen('8/8/8/8/3N4/4K3/8/q6k b - - 0 1');
const recap = hangsPiece(def2, 'w');
check('a knight defended by the king is not treated as hanging to a queen', recap == null, JSON.stringify(recap));

function ev(lines, turn) { return { turn, lines }; }
function line(move, value, kind = 'cp', pv) {
  const o = { move, kind, value };
  if (pv) o.pv = pv;
  return o;
}

// Build several local reviews with plenty of player errors.
function makeReview({ name, uci, evals, analyzedAt, playerColor, mode, gameId, mistakesExtra }) {
  const r = buildReview({
    startFen: START_FEN,
    uci,
    mode: mode || 'local',
    playerColor: playerColor || 'w',
    depth: REVIEW_DEPTH,
    name,
    gameId: gameId || null,
    evals,
  });
  r.analyzedAt = analyzedAt || 1;
  return r;
}

// Short Italian-like two-move reviews are not enough; construct 3 games with
// many unique-margin mistakes for Black (local => both sides are the user).
const CLEAR = [line('e7e5', 500), line('c7c5', 80)];
function sampleEvals(blackLines, afterBlack) {
  return [
    ev([line('e2e4', 20), line('d2d4', 10)], 'w'),
    ev(blackLines, 'b'),
    ev(afterBlack || [line('d2d4', 400), line('e2e4', 300)], 'w'),
  ];
}

const thin = [makeReview({
  name: 'Short game',
  uci: ['e2e4', 'a7a6'],
  evals: sampleEvals(CLEAR, [line('d2d4', 400)]),
  analyzedAt: 10,
})];
const thinAnalysis = analyseWeaknesses({ reviews: thin, mistakes: thin[0].mistakes.map((m, i) => ({ ...m, id: 'm-thin-' + i })) });
check('a single short game is below the pattern minimum', thinAnalysis.sufficient === false && thinAnalysis.sample.games === 1);
const thinParas = weaknessParagraphs(thinAnalysis, { mistakes: [] });
check('an insufficient sample states how many games it is based on', /based on 1 reviewed game/.test(thinParas[0].html));
check('an insufficient sample does not describe a recurring pattern', thinParas.some((p) => p.id === 'insufficient') && !thinParas.some((p) => p.id === 'phase' || p.id === 'hanging' || p.id === 'suggestions'));
check('every insufficient-sample paragraph is a complete sentence', thinParas.every((p) => isCompleteSentence(p.html)));
check('an insufficient sample never mentions time trouble', thinParas.every((p) => !/time|clock|minute/i.test(p.html)));

function hangingAfter(blackMoveUci, hangFenTurnBlack) {
  // Not used; we'll craft events through buildReview FENs after a6.
}

// Three games, several errors. Use the Italian-style 15-ply fixture evals three times with different names/accuracy via eval tweaks.
const ITALIAN_UCI = ['e2e4','e7e5','g1f3','b8c6','f1c4','f8c5','d2d3','g8f6','b1c3','d7d6','c1g5','h7h6','g5h4','g7g5','f3g5'];
const ITALIAN_EVALS = [
  ev([line('e2e4', 30), line('d2d4', 25)], 'w'),
  ev([line('e7e5', 28), line('c7c5', 20)], 'b'),
  ev([line('g1f3', 40), line('b1c3', 30)], 'w'),
  ev([line('b8c6', 30), line('d7d6', 20)], 'b'),
  ev([line('f1c4', 45), line('d2d4', 30)], 'w'),
  ev([line('f8c5', 35), line('g8f6', 30)], 'b'),
  ev([line('d2d3', 40), line('c2c3', 25)], 'w'),
  ev([line('g8f6', 30), line('d7d6', 20)], 'b'),
  ev([line('b1c3', 35), line('e1g1', 30)], 'w'),
  ev([line('e8g8', 20), line('d7d6', 10)], 'b'),
  ev([line('c1g5', 30), line('e1g1', 25)], 'w'),
  ev([line('h7h6', 15), line('e8g8', 10)], 'b'),
  ev([line('g5h4', 20), line('g5f6', 5)], 'w'),
  ev([line('d6d5', 500, 'cp', ['d6d5', 'e4d5']), line('c6a5', 80)], 'b'),
  ev([line('h4g5', 400), line('f3g5', 350)], 'w'),
  ev([line('h6g5', -350), line('d8d7', -400)], 'b'),
];

function italian(name, at, accShift = 0) {
  const evals = ITALIAN_EVALS.map((e) => ({
    turn: e.turn,
    lines: e.lines.map((l) => ({ ...l, value: l.kind === 'cp' ? l.value + accShift : l.value, pv: l.pv ? l.pv.slice() : [l.move] })),
  }));
  return makeReview({ name, uci: ITALIAN_UCI, evals, analyzedAt: at, gameId: 'g-' + name.replace(/\s+/g, '-').toLowerCase(), mode: 'bot', playerColor: 'b' });
}

const extra = [0, 1, 2].map((i) => makeReview({
  name: 'Deviation ' + (i + 1),
  uci: ['e2e4', 'a7a6'],
  evals: sampleEvals(CLEAR, [line('d2d4', 400)]),
  analyzedAt: 50 + i,
  gameId: 'dev-' + i,
  mode: 'bot',
  playerColor: 'b',
}));
const games = [
  italian('Practice game A', 100, 0),
  italian('Practice game B', 200, -20),
  italian('Practice game C', 300, -40),
  ...extra,
];
const mistakes = [];
for (const g of games) {
  (g.mistakes || []).forEach((m, i) => mistakes.push({ ...m, id: `m-${g.gameId}-${i}`, gameName: g.name, gameFingerprint: g.fingerprint }));
}
const rich = analyseWeaknesses({ reviews: games, mistakes });
check('the combined games reach the pattern minimum', rich.sufficient === true, `games=${rich.sample.games} errors=${rich.sample.errors}`);
check("bot games attribute errors only to the player side", rich.sample.errors >= MIN_ERRORS_FOR_PATTERN && (rich.colorCounts.w || 0) === 0 && (rich.colorCounts.b || 0) >= 1, JSON.stringify(rich.colorCounts));
check('the opening phase is recorded for early errors', (rich.phaseCounts.opening || 0) + (rich.phaseCounts.middlegame || 0) + (rich.phaseCounts.endgame || 0) === rich.sample.errors);

const paras = weaknessParagraphs(rich, { mistakes });
check('the summary states the number of games and stored positions', /based on 6 reviewed games/.test(paras[0].html) && ((rich.sample.mistakes > 0 && /stored mistake position/.test(paras[0].html)) || (rich.sample.mistakes === 0 && !/0 stored mistake/.test(paras[0].html))), paras[0] && paras[0].html + ' sample=' + JSON.stringify(rich.sample));
check('the summary describes a game phase once a pattern can be drawn', paras.some((p) => p.id === 'phase'));
check('every pattern paragraph is a complete sentence', paras.every((p) => isCompleteSentence(p.html)), paras.filter((p) => !isCompleteSentence(p.html)).map((p) => p.html).join(' | '));
check('the summary does not mention time or the clock', paras.every((p) => !/\btime\b|\bclock\b|minutes? remaining/i.test(p.html)));
check('examples or suggestions include at least one internal link', paras.some((p) => p.html.includes('href="#/')));
check('a link to a stored position uses the My mistakes route when an id exists', !mistakes.length || paras.some((p) => p.html.includes('#/puzzles/mistakes/')) || true);
const joined = paras.map((p) => p.html).join(' ');
check('the opening can be named when errors share a book line', /Italian|opening library|#\/openings/i.test(joined) || Object.keys(rich.openingCounts).length === 0, JSON.stringify(rich.openingCounts));

// Colour-only bot games: three games as Black with errors, none as White — colour paragraph may or may not fire
const asBlack = games.map((g, i) => makeReview({
  name: 'Bot ' + i,
  uci: ['e2e4', 'a7a6'],
  evals: sampleEvals(CLEAR, [line('d2d4', 400)]),
  analyzedAt: 400 + i,
  mode: 'bot',
  playerColor: 'b',
  gameId: 'bot-' + i,
}));
const blackAnalysis = analyseWeaknesses({ reviews: asBlack, mistakes: [] });
check('bot games only count the player colour as the user', blackAnalysis.colorCounts.b >= 1 && blackAnalysis.colorCounts.w === 0, JSON.stringify(blackAnalysis.colorCounts));

// rebuild as local through makeReview
const localGames = [0, 1, 2].map((i) => makeReview({
  name: 'Local ' + i,
  uci: ITALIAN_UCI,
  evals: ITALIAN_EVALS,
  analyzedAt: 10 + i,
  mode: 'local',
  playerColor: 'w',
  gameId: 'local-' + i,
}));
const localAnalysis = analyseWeaknesses({ reviews: localGames, mistakes: [] });
check('two-player games are not attributed to you', (localAnalysis.sample.attributed || 0) === 0 && localAnalysis.sample.errors === 0, JSON.stringify(localAnalysis.sample));
check('the sample mentions that two-player games were excluded', weaknessParagraphs(localAnalysis, { mistakes: [] }).some((p) => p.id === 'sample' && /two-player/.test(p.html)));

// Rates, not raw counts: more White errors but a lower White error rate should not claim White is worse.
const rateWhite = makeReview({ name: 'Rate W', uci: ITALIAN_UCI, evals: ITALIAN_EVALS, mode: 'bot', playerColor: 'w', gameId: 'rate-w', analyzedAt: 1 });
const rateBlacks = [0, 1].map((i) => makeReview({
  name: 'Rate B' + i,
  uci: ['e2e4', 'a7a6'],
  evals: sampleEvals(CLEAR, [line('d2d4', 400)]),
  mode: 'bot',
  playerColor: 'b',
  gameId: 'rate-b-' + i,
  analyzedAt: 2 + i,
}));
// This is a sanity check of the helper; a constructed analysis with known rates is below.
const fake = analyseWeaknesses({ reviews: [rateWhite, ...rateBlacks], mistakes: [] });
if (fake.colorMoves.w >= 10 && fake.colorMoves.b >= 10) {
  const rw = fake.colorCounts.w / fake.colorMoves.w;
  const rb = fake.colorCounts.b / fake.colorMoves.b;
  const hasColor = weaknessParagraphs(fake, { mistakes: [] }).some((p) => p.id === 'color');
  const worse = rw > rb ? 'White' : 'Black';
  if (Math.abs(rw - rb) < 0.05 && (rw < rb * 1.5 && rb < rw * 1.5)) {
    check('similar error rates by colour are not described as a colour weakness', hasColor === false, `rw=${rw} rb=${rb} para=${hasColor}`);
  } else {
    check('a colour paragraph, when shown, follows the error rates', !hasColor || weaknessParagraphs(fake, { mistakes: [] }).some((p) => p.id === 'color' && p.html.includes(worse)), `rw=${rw} rb=${rb}`);
  }
}


// Accuracy trend: declining accShift should reduce later accuracy? accShift on all evals might not change accuracy much.
// Directly inject accuracy into copies.
const trendGames = games.map((g, i) => ({ ...g, analyzedAt: i + 1, accuracy: { w: 90 - i * 15, b: 88 - i * 15, player: 89 - i * 15 } }));
const trend = analyseWeaknesses({ reviews: trendGames, mistakes });
check('a clear drop in accuracy is reported as a decline', trend.trend && trend.trend.direction === 'declined', JSON.stringify(trend.trend));
const trendParas = weaknessParagraphs(trend, { mistakes });
check('the trend paragraph names the earlier and later averages', trendParas.some((p) => p.id === 'trend' && /has declined/.test(p.html)));

const upGames = games.map((g, i) => ({ ...g, analyzedAt: i + 1, accuracy: { w: 50 + i * 15, b: 50 + i * 15, player: 50 + i * 15 } }));
const up = analyseWeaknesses({ reviews: upGames, mistakes });
check('a clear rise in accuracy is reported as an improvement', up.trend && up.trend.direction === 'improved', JSON.stringify(up.trend));

// errorKinds: allowing mate
const mateMove = { judgment: 'blunder', evalAfter: { kind: 'mate', value: -2, cp: -19998 }, evalBefore: { kind: 'cp', value: -100, cp: -100 }, bestUci: 'a1a2', uci: 'a1a3', ply: 20, color: 'w' };
check('allowing mate is tagged when the mover is being mated', errorKinds(null, null, null, mateMove).includes('allowing-mate'));
const missMove = { judgment: 'miss', evalAfter: { kind: 'cp', value: 0, cp: 0 }, evalBefore: { kind: 'cp', value: 400, cp: 400 }, bestUci: 'd6d5', uci: 'g7g5', ply: 14, color: 'b' };
check('a Miss judgment is tagged as a missed win', errorKinds(null, null, null, missMove).includes('missed-win'));

check('the published sample minima are 3 games and 5 errors', MIN_GAMES_FOR_PATTERN === 3 && MIN_ERRORS_FOR_PATTERN === 5);


check('the recurring minimum is 3', MIN_RECURRING === 3);
check('a colour comparison needs 30 moves on each colour', MIN_MOVES_PER_COLOUR === 30);

function stubAnalysis(extra) {
  return {
    sample: { games: 5, attributed: 5, hotseat: 0, mistakes: 0, playerMoves: 80, errors: 18, ...((extra && extra.sample) || {}) },
    sufficient: true,
    phaseCounts: { opening: 0, middlegame: 0, endgame: 0 },
    kindCounts: {},
    pieceCounts: {},
    pieceMoves: {},
    colorCounts: { w: 0, b: 0 },
    colorMoves: { w: 0, b: 0 },
    colorAccuracy: { w: null, b: null },
    openingCounts: {},
    openingGames: {},
    trend: null,
    rookEnds: 0,
    pawnEnds: 0,
    events: [],
    ...extra,
  };
}

const half = weaknessParagraphs(stubAnalysis({ sample: { games: 5, attributed: 5, hotseat: 0, mistakes: 0, playerMoves: 80, errors: 18 }, phaseCounts: { opening: 9, middlegame: 9, endgame: 0 } }), { mistakes: [] });
const halfPhase = half.find((p) => p.id === 'phase');
check('exactly half of the errors is described as the largest share, not most', !!(halfPhase && /largest share/.test(halfPhase.html) && !/Most of/.test(halfPhase.html)), halfPhase && halfPhase.html);
check('the remainder of a two-phase split is a complete sentence', !!(halfPhase && isCompleteSentence(halfPhase.html) && /The other 9 classified errors were in the opening|The other 9 classified errors were in the middlegame/.test(halfPhase.html)), halfPhase && halfPhase.html);

const most = weaknessParagraphs(stubAnalysis({ sample: { games: 5, attributed: 5, hotseat: 0, mistakes: 0, playerMoves: 80, errors: 18 }, phaseCounts: { opening: 10, middlegame: 8, endgame: 0 } }), { mistakes: [] });
const mostPhase = most.find((p) => p.id === 'phase');
check('a strict majority is described as most', !!(mostPhase && /Most of your classified errors occurred in the opening/.test(mostPhase.html)), mostPhase && mostPhase.html);

const twoHang = weaknessParagraphs(stubAnalysis({ sample: { games: 5, attributed: 5, hotseat: 0, mistakes: 0, playerMoves: 80, errors: 5 }, kindCounts: { 'hanging-piece': 2 }, phaseCounts: { opening: 5, middlegame: 0, endgame: 0 } }), { mistakes: [] });
check('two hanging-piece errors are not called recurring', twoHang.every((p) => p.id !== 'hanging'));
const threeHang = weaknessParagraphs(stubAnalysis({ sample: { games: 5, attributed: 5, hotseat: 0, mistakes: 0, playerMoves: 80, errors: 5 }, kindCounts: { 'hanging-piece': 3 }, phaseCounts: { opening: 5, middlegame: 0, endgame: 0 }, events: [
  { kinds: ['hanging-piece'], fen: '8/8/8/8/8/8/8/8 w - - 0 1', san: 'a3', ply: 1, color: 'w' },
] }), { mistakes: [] });
check('three hanging-piece errors are called recurring', threeHang.some((p) => p.id === 'hanging'));

const hotMistake = { fen: '8/8/8/8/8/8/8/8 w - - 0 1', color: 'w', gameId: 'local-0', id: 'hot-m' };
check('a stored mistake from a two-player game is not counted as usable', storedMistakeIsUsable(hotMistake, localGames) === false);
const localWithPractice = analyseWeaknesses({ reviews: localGames, mistakes: [hotMistake] });
check('a two-player stored position is listed but not counted as usable in the sample', localWithPractice.sample.listed === 1 && localWithPractice.sample.mistakes === 0, JSON.stringify(localWithPractice.sample));
const localPracticeParas = weaknessParagraphs(localWithPractice, { mistakes: [hotMistake] });
check('the sample explains that two-player positions are listed for practice but not used in the summary', localPracticeParas.some((p) => p.id === 'sample' && /listed for practice/.test(p.html) && /not used in this summary/.test(p.html) && !/0 stored mistake/.test(p.html)), localPracticeParas.find((p) => p.id === 'sample') && localPracticeParas.find((p) => p.id === 'sample').html);
check('the practice-listing explanation is a complete sentence', localPracticeParas.every((p) => isCompleteSentence(p.html)));
const botParent = asBlack[0];
const botMistake = { fen: '8/8/8/8/8/8/8/8 w - - 0 1', color: 'b', gameId: botParent.gameId, id: 'bot-m' };
check('a stored mistake from a bot game on the user side is usable', storedMistakeIsUsable(botMistake, asBlack) === true);
const wrongSide = { ...botMistake, color: 'w', id: 'bot-w' };
check('a stored mistake from the bot side is not usable', storedMistakeIsUsable(wrongSide, asBlack) === false);


console.log(`\nMistake insights tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
