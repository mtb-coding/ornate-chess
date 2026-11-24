// Opening recognition. Pure ES module (no DOM), importable in Node.
// Data: src/data/openings.js, generated from lichess-org/chess-openings (CC0-1.0).
//
// identifyOpening(list) and identifyOpeningForGame(game, {ply}) return
//   { eco, name, plies, lastBookPly, matchedBy, pgn } or null
// where `plies` is the length of the named reference line, `lastBookPly` is the
// last ply of the given moves whose position is a named opening position, and
// `matchedBy` is 'sequence' (the moves equal the reference line) or
// 'transposition' (same position reached by another move order).
import { Position, START_FEN } from './engine.js';
import { OPENINGS_DATA } from './data/openings.js';

/** Parsed dataset: array of {eco, name, sans: string[]}. */
export const OPENINGS = OPENINGS_DATA.split('\n').map((line) => {
  const [eco, name, moves] = line.split('|');
  return { eco, name, sans: moves.split(' ') };
});

let index = null; // { byHash: Map<hash, entry>, bySeq: Map<sanString, entry>, startHash }

function buildIndex() {
  if (index) return index;
  const byHash = new Map();
  const bySeq = new Map();
  const start = Position.fromFen(START_FEN);
  for (const o of OPENINGS) {
    let pos = start;
    for (const san of o.sans) {
      const m = pos.parseSan(san);
      if (!m) { pos = null; break; }
      pos = pos.makeMove(m);
    }
    if (!pos) continue;
    const entry = { eco: o.eco, name: o.name, plies: o.sans.length, pgn: toPgnMoves(o.sans) };
    bySeq.set(o.sans.join(' '), entry);
    const h = pos.hash();
    // Positions are unique in the current dataset; keep the first entry if not.
    if (!byHash.has(h)) byHash.set(h, entry);
  }
  index = { byHash, bySeq, startHash: start.hash() };
  return index;
}

function toPgnMoves(sans) {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ');
}

/**
 * Core matcher. `positions` is an array of Position (index 0 = start, must be
 * the standard start), `sans` the SAN of each ply.
 */
function match(positions, sans) {
  if (!positions.length || positions[0].hash() !== buildIndex().startHash) return null;
  const { byHash, bySeq } = index;
  let best = null;
  let bestPly = 0;
  for (let ply = 1; ply < positions.length; ply++) {
    const exact = bySeq.get(sans.slice(0, ply).join(' '));
    const byPos = exact || byHash.get(positions[ply].hash());
    if (byPos) { best = { entry: byPos, exact: !!exact }; bestPly = ply; }
  }
  if (!best) return null;
  const e = best.entry;
  return { eco: e.eco, name: e.name, plies: e.plies, pgn: e.pgn, lastBookPly: bestPly, matchedBy: best.exact ? 'sequence' : 'transposition' };
}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * Identify the opening from a list of moves in SAN ("e4", "Nf3") or UCI
 * ("e2e4"), played from the standard starting position. Returns null when no
 * named opening matches or when a move is illegal.
 */
export function identifyOpening(moves) {
  if (!Array.isArray(moves)) return null;
  buildIndex();
  let pos = Position.fromFen(START_FEN);
  const positions = [pos];
  const sans = [];
  for (const raw of moves) {
    const t = String(raw).trim();
    const m = UCI_RE.test(t) ? pos.parseUci(t) : pos.parseSan(t);
    if (!m) break; // stop at the first move that cannot be played
    sans.push(pos.toSan(m));
    pos = pos.makeMove(m);
    positions.push(pos);
  }
  return match(positions, sans);
}

/**
 * Identify the opening of an engine.js Game, using the positions up to `ply`
 * (default: all moves). Pass the viewed ply to follow history navigation.
 * Games that start from a custom FEN return null.
 */
export function identifyOpeningForGame(game, { ply } = {}) {
  if (!game || !game.positions) return null;
  const n = game.positions.length - 1;
  const upto = ply == null ? n : Math.max(0, Math.min(n, ply));
  return match(game.positions.slice(0, upto + 1), game.sans.slice(0, upto));
}

/** Header fields for PGN export, or {} when no opening matches. */
export function openingHeaders(result) {
  return result ? { ECO: result.eco, Opening: result.name } : {};
}
