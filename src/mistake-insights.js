/**
 * Analysis of recurring shortcomings from reviewed games and stored
 * My mistakes positions. Pure ES module (no DOM). The prose is written only
 * from counts that the data actually support; below the minimum sample the
 * summary states the sample size and does not describe a pattern.
 */
import { Position, START_FEN, PIECE_VALUES } from './engine.js';
import { identifyOpening } from './openings.js';
import { LIBRARY } from './data/opening-library.js';
import {
  FLAGGED, isMateScore, toCp, MATE_CP,
} from './review.js';

/** Reviewed games needed before a recurring pattern is described. */
export const MIN_GAMES_FOR_PATTERN = 3;
/** Classified errors needed before a recurring pattern is described. */
export const MIN_ERRORS_FOR_PATTERN = 5;
/** Occurrences needed before a pattern is called recurring. */
export const MIN_RECURRING = 3;
/** Reviewed games needed for an accuracy trend (two non-overlapping halves). */
export const MIN_TREND_GAMES = 4;
/** Player moves required on each colour before a colour comparison is drawn. */
export const MIN_MOVES_PER_COLOUR = 30;
/** Reviewed games in an opening required before that opening is named as a pattern. */
export const MIN_OPENING_GAMES = 3;
/** Colour error-rate ratio that counts as a meaningful difference. */
export const COLOR_RATE_RATIO = 1.5;
/** Colour error-rate gap, in errors per move, that counts as a meaningful difference. */
export const COLOR_RATE_GAP = 0.05;
/** Piece error-rate ratio above the base rate that counts as a meaningful difference. */
export const PIECE_RATE_RATIO = 1.5;

/**
 * The side that belongs to the user in this review, or null when it is not
 * known (two-player and hot-seat games, and reviews with no recorded colour).
 */
export function userSide(review) {
  if (!review) return null;
  if (review.mode === 'bot' && (review.playerColor === 'w' || review.playerColor === 'b')) {
    return review.playerColor;
  }
  return null;
}

/**
 * A stored mistake is used in the weaknesses analysis only when the review
 * it came from records the user's side, and the move was played by that side.
 */
export function storedMistakeIsUsable(puzzle, reviews) {
  if (!puzzle || !puzzle.fen) return false;
  const parent = (reviews || []).find((r) => r && (
    (puzzle.gameFingerprint && r.fingerprint === puzzle.gameFingerprint)
    || (puzzle.gameId && r.gameId === puzzle.gameId)
  ));
  const side = userSide(parent);
  if (!side) return false;
  if (puzzle.color && puzzle.color !== side) return false;
  return true;
}

const PIECE_NAMES = Object.freeze({
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
});
const PIECE_PLURAL = Object.freeze({
  p: 'pawns', n: 'knights', b: 'bishops', r: 'rooks', q: 'queens', k: 'kings',
});

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


function fileOf(sq) { return sq & 7; }
function rankOf(sq) { return sq >> 3; }
function onBoard(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }
function sqAt(f, r) { return f + r * 8; }

function materialPawnUnits(pos) {
  let s = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.pieceAt(sq);
    if (!p || p.type === 'k') continue;
    const v = PIECE_VALUES[p.type] || 0;
    s += v >= 900 ? 9 : v >= 500 ? 5 : v >= 300 ? 3 : 1;
  }
  return s;
}

function countType(pos, type) {
  let n = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.pieceAt(sq);
    if (p && p.type === type) n++;
  }
  return n;
}

function countMinorsAndMajors(pos) {
  let n = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.pieceAt(sq);
    if (p && p.type !== 'k' && p.type !== 'p') n++;
  }
  return n;
}

/**
 * Opening, middlegame or endgame from both ply and remaining material.
 * Opening: the first ten full moves while most of the army is still on the
 * board. Endgame: queens are off and material is low, or the two sides
 * together have at most 24 pawn units excluding kings.
 */
export function gamePhase(pos, ply) {
  const mat = materialPawnUnits(pos);
  const queens = countType(pos, 'q');
  const heavy = countMinorsAndMajors(pos);
  if (mat <= 24 || (queens === 0 && (mat <= 30 || heavy <= 6))) return 'endgame';
  if ((ply || 0) <= 20 && mat >= 60) return 'opening';
  return 'middlegame';
}

const KNIGHT_DELTAS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KING_DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const SLIDERS = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  q: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
};

function pawnCaptureSquares(sq, color) {
  const f = fileOf(sq);
  const r = rankOf(sq);
  const dir = color === 'w' ? 1 : -1;
  const out = [];
  if (onBoard(f - 1, r + dir)) out.push(sqAt(f - 1, r + dir));
  if (onBoard(f + 1, r + dir)) out.push(sqAt(f + 1, r + dir));
  return out;
}

/** Squares attacked by the piece on `from` in `pos`. */
export function attackedSquares(pos, from) {
  const pc = pos.pieceAt(from);
  if (!pc) return [];
  const out = [];
  if (pc.type === 'n') {
    for (const [df, dr] of KNIGHT_DELTAS) {
      const f = fileOf(from) + df, r = rankOf(from) + dr;
      if (onBoard(f, r)) out.push(sqAt(f, r));
    }
    return out;
  }
  if (pc.type === 'k') {
    for (const [df, dr] of KING_DELTAS) {
      const f = fileOf(from) + df, r = rankOf(from) + dr;
      if (onBoard(f, r)) out.push(sqAt(f, r));
    }
    return out;
  }
  if (pc.type === 'p') return pawnCaptureSquares(from, pc.color);
  const rays = SLIDERS[pc.type];
  if (!rays) return out;
  for (const [df, dr] of rays) {
    let f = fileOf(from) + df, r = rankOf(from) + dr;
    while (onBoard(f, r)) {
      const sq = sqAt(f, r);
      out.push(sq);
      if (pos.pieceAt(sq)) break;
      f += df; r += dr;
    }
  }
  return out;
}

/**
 * After `move` is played, the moved piece attacks two or more enemy pieces
 * (a fork). Knights and royal forks are included.
 */
export function isFork(posAfterMove, move) {
  if (!posAfterMove || !move) return false;
  const attacker = posAfterMove.pieceAt(move.to);
  if (!attacker) return false;
  const hits = [];
  for (const sq of attackedSquares(posAfterMove, move.to)) {
    const q = posAfterMove.pieceAt(sq);
    if (q && q.color !== attacker.color) hits.push(q.type);
  }
  if (hits.length < 2) return false;
  // A pawn attacking two pieces of equal or greater value, or any piece
  // attacking two units, counts as a fork. King+anything is included.
  return true;
}

/**
 * After a slider is placed on `move.to`, an enemy piece sits on the same ray
 * as a more valuable enemy unit (a pin or a skewer).
 */
export function isPinOrSkewer(posAfterMove, move) {
  if (!posAfterMove || !move) return false;
  const attacker = posAfterMove.pieceAt(move.to);
  if (!attacker || !SLIDERS[attacker.type]) return false;
  const rays = SLIDERS[attacker.type];
  const value = (t) => (t === 'k' ? 10000 : (PIECE_VALUES[t] || 0));
  for (const [df, dr] of rays) {
    const seen = [];
    let f = fileOf(move.to) + df, r = rankOf(move.to) + dr;
    while (onBoard(f, r)) {
      const sq = sqAt(f, r);
      const q = posAfterMove.pieceAt(sq);
      if (q) {
        if (q.color === attacker.color) break;
        seen.push(q.type);
        if (seen.length === 2) break;
      }
      f += df; r += dr;
    }
    if (seen.length === 2) {
      // Pin: lesser (or equal) piece in front of a more valuable one; skewer: the reverse.
      if (seen[1] === 'k' || value(seen[1]) >= 300 || value(seen[0]) >= 300) return true;
    }
  }
  return false;
}

/**
 * The side that has just moved left a minor or major piece en prise.
 * `posAfter` has the opponent to move.
 */
export function hangsPiece(posAfter, moverColor) {
  if (!posAfter) return null;
  const captures = posAfter.legalMoves().filter((m) => m.captured && m.captured !== 'p' && m.captured !== 'k');
  for (const m of captures) {
    const val = PIECE_VALUES[m.captured] || 0;
    if (val < 300) continue;
    const next = posAfter.makeMove(m);
    const recaps = next.legalMoves().filter((r) => r.to === m.to && r.captured);
    if (!recaps.length) return { type: m.captured, from: m.from, to: m.to };
    // The recapture is of a more valuable piece than the one taken, so the
    // first capture still wins material (a hanging or poorly defended piece).
    const recapVal = Math.max(...recaps.map((r) => PIECE_VALUES[r.captured] || 0));
    if (val - recapVal >= 200) return { type: m.captured, from: m.from, to: m.to };
  }
  return null;
}

function allowingMate(move) {
  if (!move || !move.evalAfter) return false;
  const score = { kind: move.evalAfter.kind, value: move.evalAfter.value };
  // evalAfter.cp is the mover's score after the move (playedCp).
  if (typeof move.evalAfter.cp === 'number' && move.evalAfter.cp <= -MATE_CP) return true;
  if (isMateScore(score) && toCp({ kind: score.kind === 'mate' ? 'mate' : 'cp', value: move.evalAfter.cp ?? score.value }) <= -MATE_CP) return true;
  // playedScore was inverted; cp on evalAfter is already the mover's view.
  return isMateScore({ kind: 'cp', value: move.evalAfter.cp }) && move.evalAfter.cp < 0;
}

function missedMate(move) {
  if (!move || !move.evalBefore) return false;
  const cp = typeof move.evalBefore.cp === 'number' ? move.evalBefore.cp : toCp(move.evalBefore);
  return cp >= MATE_CP || (move.evalBefore.kind === 'mate' && (move.evalBefore.value || 0) > 0);
}

function rookEndgame(pos) {
  if (gamePhase(pos, 40) !== 'endgame') return false;
  return countType(pos, 'r') >= 1 && countType(pos, 'q') === 0;
}

function pawnEndgame(pos) {
  if (gamePhase(pos, 40) !== 'endgame') return false;
  return countMinorsAndMajors(pos) === 0;
}

/**
 * Tactical and technical tags for one classified error.
 * @returns {string[]}
 */
export function errorKinds(posBefore, posAfter, playedMove, reviewMove) {
  const kinds = [];
  if (!reviewMove) return kinds;
  if (allowingMate(reviewMove)) kinds.push('allowing-mate');
  if (reviewMove.judgment === 'miss') kinds.push('missed-win');
  if (missedMate(reviewMove) && reviewMove.judgment !== 'best' && reviewMove.bestUci && reviewMove.bestUci !== reviewMove.uci) {
    kinds.push('missed-mate');
  }
  if (posAfter && hangsPiece(posAfter, posBefore ? posBefore.turn : reviewMove.color)) kinds.push('hanging-piece');
  if (posBefore && reviewMove.bestUci && reviewMove.bestUci !== reviewMove.uci) {
    const best = posBefore.parseUci(reviewMove.bestUci);
    if (best) {
      const afterBest = posBefore.makeMove(best);
      if (isFork(afterBest, best)) kinds.push('missed-fork');
      if (isPinOrSkewer(afterBest, best)) kinds.push('missed-pin');
    }
  }
  if (posBefore && gamePhase(posBefore, reviewMove.ply) === 'endgame') kinds.push('endgame-technique');
  return kinds;
}

function openingHref(name) {
  if (!name) return '#/openings';
  const exact = LIBRARY.find((o) => o.name === name);
  if (exact) return `#/openings/${encodeURIComponent(exact.id)}`;
  const start = LIBRARY.find((o) => name.startsWith(o.name) || o.name.startsWith(name.split(':')[0]));
  if (start) return `#/openings/${encodeURIComponent(start.id)}`;
  return '#/openings';
}

function mistakeHref(mistakes, event) {
  const fen = event.fen;
  const sol = event.bestUci;
  if (fen && Array.isArray(mistakes)) {
    const hit = mistakes.find((p) => p.fen === fen && (!sol || (p.solution && p.solution[0] === sol)));
    if (hit && hit.id) return { href: `#/puzzles/mistakes/${encodeURIComponent(hit.id)}`, label: eventLabel(event) };
  }
  if (event.gameId) return { href: `#/review/${encodeURIComponent(event.gameId)}`, label: eventLabel(event) };
  return null;
}

function eventLabel(event) {
  const san = event.san || 'this move';
  const num = Math.ceil((event.ply || 1) / 2);
  const dots = event.color === 'b' ? '...' : '.';
  const game = event.gameName ? ` in ${event.gameName}` : '';
  return esc(`${num}${dots}${san}${game}`);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function phaseName(p) {
  return p === 'opening' ? 'the opening' : p === 'endgame' ? 'the endgame' : 'the middlegame';
}

function collectEvents(reviews, mistakes) {
  const events = [];
  const seen = new Set();
  for (const review of reviews || []) {
    if (!review || !Array.isArray(review.moves) || !Array.isArray(review.positions)) continue;
    let opening = null;
    const startFen = review.startFen || START_FEN;
    if (startFen === START_FEN && Array.isArray(review.uci)) {
      try { opening = identifyOpening(review.uci); } catch { opening = null; }
    }
    for (const move of review.moves) {
      const side = userSide(review);
      if (!side || !move || move.color !== side) continue;
      if (!FLAGGED.includes(move.judgment)) continue;
      const beforeFen = review.positions[move.ply - 1] && review.positions[move.ply - 1].fen;
      const afterFen = review.positions[move.ply] && review.positions[move.ply].fen;
      let posBefore = null, posAfter = null, played = null;
      try {
        if (beforeFen) posBefore = Position.fromFen(beforeFen);
        if (afterFen) posAfter = Position.fromFen(afterFen);
        if (posBefore && move.uci) played = posBefore.parseUci(move.uci);
      } catch { /* skip broken rows */ }
      const phase = posBefore ? gamePhase(posBefore, move.ply) : (move.ply <= 20 ? 'opening' : 'middlegame');
      const kinds = errorKinds(posBefore, posAfter, played, move);
      const fen = beforeFen || '';
      const key = `${fen}|${move.uci || ''}`;
      seen.add(key);
      events.push({
        fen,
        san: move.san,
        uci: move.uci,
        bestUci: move.bestUci,
        bestSan: move.bestSan,
        ply: move.ply,
        color: move.color,
        judgment: move.judgment,
        piece: played ? played.piece : null,
        phase,
        kinds,
        openingName: opening ? opening.name : null,
        gameName: review.name || '',
        gameId: review.gameId || null,
        fingerprint: review.fingerprint || null,
        rookEndgame: posBefore ? rookEndgame(posBefore) : false,
        pawnEndgame: posBefore ? pawnEndgame(posBefore) : false,
      });
    }
  }
  for (const p of mistakes || []) {
    if (!p || !p.fen) continue;
    const key = `${p.fen}|${p.playedUci || ''}`;
    if (seen.has(key)) continue;
    const parent = (reviews || []).find((r) => r && (
      (p.gameFingerprint && r.fingerprint === p.gameFingerprint)
      || (p.gameId && r.gameId === p.gameId)
    ));
    const parentSide = userSide(parent);
    if (!parentSide || (p.color && p.color !== parentSide)) continue;
    let posBefore = null, posAfter = null, played = null;
    try {
      posBefore = Position.fromFen(p.fen);
      if (p.playedUci) {
        played = posBefore.parseUci(p.playedUci);
        if (played) posAfter = posBefore.makeMove(played);
      }
    } catch { posBefore = null; }
    const moveLike = {
      judgment: p.judgment,
      ply: p.ply,
      color: p.color,
      uci: p.playedUci,
      bestUci: p.solution && p.solution[0],
      evalBefore: null,
      evalAfter: null,
    };
    const phase = posBefore ? gamePhase(posBefore, p.ply || 0) : 'middlegame';
    const kinds = errorKinds(posBefore, posAfter, played, moveLike);
    events.push({
      fen: p.fen,
      san: p.playedSan,
      uci: p.playedUci,
      bestUci: p.solution && p.solution[0],
      bestSan: p.bestSan,
      ply: p.ply,
      color: p.color,
      judgment: p.judgment,
      piece: played ? played.piece : null,
      phase,
      kinds,
      openingName: null,
      gameName: p.gameName || '',
      gameId: null,
      fingerprint: p.gameFingerprint || null,
      mistakeId: p.id,
      rookEndgame: posBefore ? rookEndgame(posBefore) : false,
      pawnEndgame: posBefore ? pawnEndgame(posBefore) : false,
    });
    seen.add(key);
  }
  return events;
}

function topKey(map) {
  let best = null, n = -1;
  for (const [k, v] of Object.entries(map)) {
    if (v > n) { n = v; best = k; }
  }
  return n > 0 ? { key: best, count: n } : null;
}

function playerAccuracy(review) {
  if (!review || !review.accuracy) return null;
  const side = userSide(review);
  if (side && typeof review.accuracy[side] === 'number') return review.accuracy[side];
  if (typeof review.accuracy.player === 'number') return review.accuracy.player;
  const w = review.accuracy.w, b = review.accuracy.b;
  if (typeof w === 'number' && typeof b === 'number') return (w + b) / 2;
  if (typeof w === 'number') return w;
  if (typeof b === 'number') return b;
  return null;
}

/**
 * Analyse reviewed games and stored mistake positions.
 * @param {{ reviews?: object[], mistakes?: object[] }} input
 */
export function analyseWeaknesses({ reviews = [], mistakes = [] } = {}) {
  const games = (reviews || []).filter((r) => r && Array.isArray(r.moves));
  const attributed = games.filter((r) => userSide(r));
  const stored = (mistakes || []).filter((p) => p && p.fen);
  const events = collectEvents(games, stored);
  const playerMoveCount = attributed.reduce((n, r) => {
    const side = userSide(r);
    return n + r.moves.filter((m) => m.color === side).length;
  }, 0);
  const phaseCounts = { opening: 0, middlegame: 0, endgame: 0 };
  const kindCounts = {};
  const pieceCounts = {};
  const pieceMoves = {};
  const colorCounts = { w: 0, b: 0 };
  const colorMoves = { w: 0, b: 0 };
  const openingCounts = {};
  const openingGames = {};
  let rookEnds = 0, pawnEnds = 0;
  for (const ev of events) {
    phaseCounts[ev.phase] = (phaseCounts[ev.phase] || 0) + 1;
    for (const k of ev.kinds) kindCounts[k] = (kindCounts[k] || 0) + 1;
    if (ev.piece) pieceCounts[ev.piece] = (pieceCounts[ev.piece] || 0) + 1;
    if (ev.color === 'w' || ev.color === 'b') colorCounts[ev.color]++;
    if (ev.openingName) openingCounts[ev.openingName] = (openingCounts[ev.openingName] || 0) + 1;
    if (ev.rookEndgame) rookEnds++;
    if (ev.pawnEndgame) pawnEnds++;
  }
  const seenOpenings = new Set();
  for (const r of attributed) {
    const side = userSide(r);
    for (const m of r.moves) {
      if (m.color !== side) continue;
      if (m.color === 'w' || m.color === 'b') colorMoves[m.color]++;
      let piece = null;
      try {
        const before = r.positions && r.positions[m.ply - 1];
        if (before && before.fen && m.uci) {
          const pos = Position.fromFen(before.fen);
          const mv = pos.parseUci(m.uci);
          if (mv) piece = mv.piece;
        }
      } catch { /* skip */ }
      if (piece) pieceMoves[piece] = (pieceMoves[piece] || 0) + 1;
    }
    let opening = null;
    const startFen = r.startFen || START_FEN;
    if (startFen === START_FEN && Array.isArray(r.uci)) {
      try { opening = identifyOpening(r.uci); } catch { opening = null; }
    }
    if (opening && opening.name) {
      const key = `${r.gameId || r.fingerprint || ''}|${opening.name}`;
      if (!seenOpenings.has(key)) {
        seenOpenings.add(key);
        openingGames[opening.name] = (openingGames[opening.name] || 0) + 1;
      }
    }
  }
  const colorAccuracy = { w: [], b: [] };
  const timeline = [];
  for (const r of attributed) {
    const acc = playerAccuracy(r);
    if (acc != null) timeline.push({ at: r.analyzedAt || 0, acc, name: r.name || '' });
    const side = userSide(r);
    const a = r.accuracy && r.accuracy[side];
    if (typeof a === 'number') colorAccuracy[side].push(a);
  }
  timeline.sort((a, b) => a.at - b.at);
  let trend = null;
  if (timeline.length >= MIN_TREND_GAMES) {
    const half = Math.floor(timeline.length / 2);
    if (half >= 2) {
      const early = timeline.slice(0, half);
      const late = timeline.slice(timeline.length - half);
      const avg = (arr) => arr.reduce((s, x) => s + x.acc, 0) / arr.length;
      const e = avg(early), l = avg(late);
      if (l - e >= 5) trend = { direction: 'improved', early: e, late: l };
      else if (e - l >= 5) trend = { direction: 'declined', early: e, late: l };
      else trend = { direction: 'stable', early: e, late: l };
    }
  }
  const sufficient = attributed.length >= MIN_GAMES_FOR_PATTERN && events.length >= MIN_ERRORS_FOR_PATTERN;
  return {
    sample: {
      games: games.length,
      attributed: attributed.length,
      hotseat: games.length - attributed.length,
      mistakes: stored.filter((p) => storedMistakeIsUsable(p, games)).length,
      listed: stored.length,
      playerMoves: playerMoveCount,
      errors: events.length,
    },
    sufficient,
    phaseCounts,
    kindCounts,
    pieceCounts,
    pieceMoves,
    colorCounts,
    colorMoves,
    colorAccuracy: {
      w: colorAccuracy.w.length ? colorAccuracy.w.reduce((s, x) => s + x, 0) / colorAccuracy.w.length : null,
      b: colorAccuracy.b.length ? colorAccuracy.b.reduce((s, x) => s + x, 0) / colorAccuracy.b.length : null,
    },
    openingCounts,
    openingGames,
    trend,
    rookEnds,
    pawnEnds,
    events,
  };
}

function meanLabel(v) {
  return String(Math.round(v));
}

function link(href, text) {
  return `<a href="${href}">${text}</a>`;
}

function exampleLinks(analysis, mistakes, n = 2) {
  const out = [];
  for (const ev of analysis.events) {
    if (out.length >= n) break;
    if (ev.mistakeId) {
      out.push({ href: `#/puzzles/mistakes/${encodeURIComponent(ev.mistakeId)}`, label: eventLabel(ev), event: ev });
      continue;
    }
    const found = mistakeHref(mistakes, ev);
    if (found) out.push({ ...found, event: ev });
  }
  return out;
}

/**
 * Full-sentence HTML paragraphs for the Your weaknesses section.
 * Link markup is included; the visible text is still a complete sentence.
 */
export function weaknessParagraphs(analysis, { mistakes = [] } = {}) {
  const paras = [];
  if (!analysis) return paras;
  const s = analysis.sample;
  const gameBit = plural(s.games, 'reviewed game', 'reviewed games');
  const posBit = plural(s.mistakes, 'stored mistake position', 'stored mistake positions');
  const listed = s.listed != null ? s.listed : s.mistakes;
  const practiceN = Math.max(0, (listed || 0) - (s.mistakes || 0));
  let sampleHtml = (s.mistakes || 0) > 0
    ? `This summary is based on ${gameBit} and ${posBit}.`
    : `This summary is based on ${gameBit}.`;
  if (s.hotseat) {
    sampleHtml += ` ${plural(s.hotseat, 'reviewed two-player game was', 'reviewed two-player games were')} not used to describe your shortcomings, because the side you played is not recorded.`;
  }
  if (practiceN > 0) {
    sampleHtml += ` ${plural(practiceN, 'position from a two-player game is listed for practice, but is', 'positions from two-player games are listed for practice, but are')} not used in this summary.`;
  }
  paras.push({
    id: 'sample',
    html: sampleHtml,
  });
  if (!analysis.sufficient) {
    paras.push({
      id: 'insufficient',
      html: 'More reviewed games are needed before a recurring pattern can be described, so no further conclusions are drawn from this sample.',
    });
    return paras;
  }
  const total = s.errors;
  const phases = ['opening', 'middlegame', 'endgame']
    .map((p) => ({ p, n: analysis.phaseCounts[p] || 0 }))
    .filter((x) => x.n)
    .sort((a, b) => b.n - a.n);
  if (phases.length) {
    const lead = phases[0];
    const rest = phases.slice(1);
    const leadWord = lead.n * 2 > total
      ? `Most of your classified errors occurred in ${phaseName(lead.p)}`
      : `The largest share of your classified errors occurred in ${phaseName(lead.p)}`;
    let html = `${leadWord}: ${lead.n} of ${total} mistakes, misses and blunders were made in that phase.`;
    if (rest.length === 1) {
      html += ` The other ${rest[0].n} classified errors were in ${phaseName(rest[0].p)}.`;
    } else if (rest.length === 2) {
      html += ` The other classified errors were ${rest[0].n} in ${phaseName(rest[0].p)} and ${rest[1].n} in ${phaseName(rest[1].p)}.`;
    }
    paras.push({ id: 'phase', html });
  }
  const kinds = analysis.kindCounts;
  const examples = exampleLinks(analysis, mistakes, 3);
  const exAt = (i) => {
    const e = examples[i];
    return e ? link(e.href, e.label) : null;
  };
  if ((kinds['hanging-piece'] || 0) >= MIN_RECURRING) {
    const n = kinds['hanging-piece'];
    const ex = examples.find((e) => e.event.kinds.includes('hanging-piece'));
    let html = `A recurring issue was leaving a piece en prise, or leaving a piece that lost material in an exchange. In ${plural(n, 'position', 'positions')}, the move that was played allowed a minor or major piece to be taken with a material gain.`;
    if (ex) html += ` One example is ${link(ex.href, ex.label)}.`;
    paras.push({ id: 'hanging', html });
  }
  const tacticN = (kinds['missed-fork'] || 0) + (kinds['missed-pin'] || 0) + (kinds['missed-mate'] || 0);
  if (tacticN >= MIN_RECURRING) {
    const bits = [];
    if (kinds['missed-fork']) bits.push(plural(kinds['missed-fork'], 'knight or piece fork', 'forks'));
    if (kinds['missed-pin']) bits.push(plural(kinds['missed-pin'], 'pin or skewer', 'pins or skewers'));
    if (kinds['missed-mate']) bits.push(plural(kinds['missed-mate'], 'forced mate', 'forced mates'));
    let list;
    if (bits.length === 1) list = bits[0];
    else if (bits.length === 2) list = `${bits[0]} and ${bits[1]}`;
    else list = `${bits[0]}, ${bits[1]}, and ${bits[2]}`;
    paras.push({
      id: 'tactics',
      html: `You missed a short tactic found in the engine's preferred line in ${plural(tacticN, 'position', 'positions')}, including ${list}.`,
    });
  }
  if ((kinds['allowing-mate'] || 0) >= 1) {
    paras.push({
      id: 'allowing-mate',
      html: `You allowed a forced mate in ${plural(kinds['allowing-mate'], 'position', 'positions')}.`,
    });
  }
  if ((kinds['missed-win'] || 0) >= MIN_RECURRING) {
    paras.push({
      id: 'missed-win',
      html: `You missed a winning opportunity in ${plural(kinds['missed-win'], 'position', 'positions')} after the opponent had already given something away.`,
    });
  }
  if ((kinds['endgame-technique'] || 0) >= MIN_RECURRING) {
    paras.push({
      id: 'endgame',
      html: `${plural(kinds['endgame-technique'], 'error', 'errors')} occurred in the endgame, which points to technique rather than to the opening or to a middlegame attack.`,
    });
  }
  const pieceTop = topKey(analysis.pieceCounts);
  const pieceMoves = analysis.pieceMoves || {};
  const allPieceMoves = Object.values(pieceMoves).reduce((s, n) => s + n, 0);
  if (pieceTop && pieceTop.count >= MIN_RECURRING && pieceTop.key !== 'p' && allPieceMoves > 0) {
    const name = PIECE_NAMES[pieceTop.key] || pieceTop.key;
    const names = PIECE_PLURAL[pieceTop.key] || name;
    const moved = pieceMoves[pieceTop.key] || 0;
    const base = moved / allPieceMoves;
    const share = pieceTop.count / total;
    if (moved && share >= base * PIECE_RATE_RATIO) {
      paras.push({
        id: 'piece',
        html: `The piece you moved most often when making a mistake, a miss or a blunder was the ${name}: ${pieceTop.count} of ${total} classified errors were ${name} moves, against a base rate of ${moved} of ${allPieceMoves} of your moves (${Math.round(base * 100)}%). Paying extra attention to the ${names} in calculation is a practical way to reduce those errors.`,
      });
    }
  }
  const cw = analysis.colorCounts.w || 0, cb = analysis.colorCounts.b || 0;
  const mw = analysis.colorMoves.w || 0, mb = analysis.colorMoves.b || 0;
  const aw = analysis.colorAccuracy.w, ab = analysis.colorAccuracy.b;
  const rateW = mw >= MIN_MOVES_PER_COLOUR ? cw / mw : null;
  const rateB = mb >= MIN_MOVES_PER_COLOUR ? cb / mb : null;
  const rateDiffers = rateW != null && rateB != null && (
    rateW >= rateB * COLOR_RATE_RATIO || rateB >= rateW * COLOR_RATE_RATIO
    || Math.abs(rateW - rateB) >= COLOR_RATE_GAP
  );
  if (rateDiffers) {
    const more = rateW > rateB ? 'White' : 'Black';
    const moreRate = more === 'White' ? rateW : rateB;
    const lessRate = more === 'White' ? rateB : rateW;
    const moreN = more === 'White' ? cw : cb;
    const lessN = more === 'White' ? cb : cw;
    const moreM = more === 'White' ? mw : mb;
    const lessM = more === 'White' ? mb : mw;
    const less = more === 'White' ? 'Black' : 'White';
    let html = `Errors were more common when you played ${more}: ${moreN} of ${moreM} moves (${Math.round(moreRate * 100)}%) were classified as an inaccuracy, a mistake, a miss or a blunder, compared with ${lessN} of ${lessM} moves (${Math.round(lessRate * 100)}%) when you played ${less}.`;
    if (aw != null && ab != null) {
      html += ` Your average accuracy was ${meanLabel(aw)} as White and ${meanLabel(ab)} as Black.`;
    }
    paras.push({ id: 'color', html });
  }
  const openTop = topKey(analysis.openingCounts);
  const openingGames = (analysis.openingGames && openTop && analysis.openingGames[openTop.key]) || 0;
  const openingTotal = Object.values(analysis.openingCounts).reduce((s, n) => s + n, 0);
  if (openTop && openTop.count >= MIN_RECURRING && openingGames >= MIN_OPENING_GAMES && openingTotal >= 3 && openTop.count / total >= 0.3) {
    const href = openingHref(openTop.key);
    paras.push({
      id: 'opening',
      html: `${link(href, esc(openTop.key))} accounted for the largest share of your errors (${openTop.count} of ${total}). Practising that opening from the library may help you leave those positions with a more familiar plan.`,
    });
  }
  if (analysis.trend && analysis.trend.direction !== 'stable') {
    const t = analysis.trend;
    const verb = t.direction === 'improved' ? 'has improved' : 'has declined';
    paras.push({
      id: 'trend',
      html: `Your accuracy ${verb} across the reviewed games, from an average of ${meanLabel(t.early)} in the earlier games to ${meanLabel(t.late)} in the later ones.`,
    });
  }
  const suggestions = [];
  if ((kinds['hanging-piece'] || 0) >= MIN_RECURRING || tacticN >= MIN_RECURRING) {
    const level = (kinds['missed-mate'] || 0) >= 2 || tacticN >= 4 ? 'hard' : 'medium';
    const href = `#/puzzles/generated?level=${level}`;
    const label = level === 'hard' ? 'generated puzzles at the hard level' : 'generated puzzles at the medium level';
    suggestions.push(`Practising the ${link(href, label)} is a direct way to work on noticing hanging pieces and short tactics.`);
  }
  if ((kinds['endgame-technique'] || 0) >= 2 || analysis.rookEnds >= 2 || analysis.pawnEnds >= 2) {
    if (analysis.rookEnds >= 2) {
      suggestions.push(`Because several of the errors occurred in rook endgames, the ${link('#/endgames/lucena', 'Lucena')} and ${link('#/endgames/philidor', 'Philidor')} practice positions are a direct next step.`);
    } else if (analysis.pawnEnds >= 2) {
      suggestions.push(`Because several of the errors occurred in king and pawn endings, the ${link('#/endgames/opposition', 'opposition')} and ${link('#/endgames/key-squares', 'key-squares')} practice positions are a direct next step.`);
    } else {
      suggestions.push(`The ${link('#/endgames', 'endgame practice positions')} are a direct way to work on the technique that these endings require.`);
    }
  }
  if (suggestions.length) {
    paras.push({ id: 'suggestions', html: suggestions.join(' ') });
  }
  if (examples.length && !paras.some((p) => p.html.includes('#/puzzles/mistakes') || p.html.includes('#/review/'))) {
    const bits = examples.slice(0, 2).map((e) => link(e.href, e.label));
    const list = bits.length === 1 ? bits[0] : `${bits[0]} and ${bits[1]}`;
    paras.push({
      id: 'examples',
      html: `Concrete examples from your reviewed play include ${list}.`,
    });
  }
  return paras;
}

/** True when a paragraph is a complete sentence (ends with a period). */
export function isCompleteSentence(html) {
  const text = String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return /[.?!]$/.test(text) && text.length > 20 && !/^\s*[A-Z][a-z]+ed\./.test(text);
}

