// The three online ratings. Bullet, blitz and rapid each keep their own
// Glicko-2 numbers, result counts and chart history. Bot games are not here.
import {
  GLICKO_START_DEVIATION, GLICKO_START_RATING, GLICKO_START_VOLATILITY, isProvisionalDeviation,
} from './glicko.js';

export const PACES = ['bullet', 'blitz', 'rapid'];
export const PACE_LABEL = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid' };
export const MAX_RATING_HISTORY = 80;

export function emptyColour() {
  return { wins: 0, draws: 0, losses: 0, games: 0 };
}

export function blankPace() {
  return {
    rating: GLICKO_START_RATING,
    deviation: GLICKO_START_DEVIATION,
    volatility: GLICKO_START_VOLATILITY,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    peak: null,
    white: emptyColour(),
    black: emptyColour(),
    history: [],
  };
}

export function blankOnlineRatings() {
  return { version: 1, bullet: blankPace(), blitz: blankPace(), rapid: blankPace() };
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 1e9) : 0;
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function colour(raw) {
  const base = emptyColour();
  if (!raw || typeof raw !== 'object') return base;
  base.wins = count(raw.wins);
  base.draws = count(raw.draws);
  base.losses = count(raw.losses);
  base.games = count(raw.games) || base.wins + base.draws + base.losses;
  return base;
}

export function normalizePace(raw) {
  const blank = blankPace();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return blank;
  const rating = finite(raw.rating, blank.rating);
  const deviation = Math.max(0, finite(raw.deviation, blank.deviation));
  const pace = {
    rating,
    deviation,
    volatility: Math.max(0.01, finite(raw.volatility, blank.volatility)),
    games: count(raw.games),
    wins: count(raw.wins),
    draws: count(raw.draws),
    losses: count(raw.losses),
    peak: typeof raw.peak === 'number' && Number.isFinite(raw.peak) ? raw.peak : null,
    white: colour(raw.white),
    black: colour(raw.black),
    history: [],
  };
  if (Array.isArray(raw.history)) {
    for (const item of raw.history) {
      if (!item || typeof item !== 'object' || !Number.isFinite(item.rating)) continue;
      pace.history.push({
        at: Number.isFinite(item.at) ? item.at : null,
        rating: item.rating,
        delta: Number.isFinite(item.delta) ? item.delta : 0,
        score: item.score,
        opponent: Number.isFinite(item.opponent) ? item.opponent : null,
        opponentName: typeof item.opponentName === 'string' ? item.opponentName : '',
        color: item.color === 'b' ? 'b' : 'w',
      });
    }
    if (pace.history.length > MAX_RATING_HISTORY) pace.history = pace.history.slice(-MAX_RATING_HISTORY);
  }
  pace.provisional = isProvisionalDeviation(pace.deviation);
  return pace;
}

/** The highest stable rating, or null while the rating is provisional or no stable rating exists yet. */
export function stablePeak(pace) {
  if (!pace || pace.provisional || !Number.isFinite(pace.peak)) return null;
  return Math.round(pace.peak);
}

export function normalizeOnlineRatings(raw) {
  const blank = blankOnlineRatings();
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    bullet: normalizePace(source.bullet || blank.bullet),
    blitz: normalizePace(source.blitz || blank.blitz),
    rapid: normalizePace(source.rapid || blank.rapid),
  };
}

function nextPeak(pace, next) {
  const carried = Number.isFinite(pace.peak) ? pace.peak : null;
  if (isProvisionalDeviation(next.deviation)) return carried;
  return Math.max(carried ?? next.rating, next.rating);
}

function addResult(bucket, score) {
  bucket.games += 1;
  if (score === 1) bucket.wins += 1;
  else if (score === 0) bucket.losses += 1;
  else bucket.draws += 1;
}

/**
 * Apply one finished game to a pace record. opponent is the other player's
 * pace record from before this game. score is 1, 0.5 or 0 for this player.
 * next is the Glicko result { rating, deviation, volatility }.
 */
export function applyPaceGame(pace, { next, score, color, opponent, opponentName, at }) {
  const before = pace.rating;
  const shownBefore = Math.round(before);
  const shownAfter = Math.round(next.rating);
  const updated = {
    ...pace,
    rating: next.rating,
    deviation: next.deviation,
    volatility: next.volatility,
    games: pace.games,
    wins: pace.wins,
    draws: pace.draws,
    losses: pace.losses,
    peak: nextPeak(pace, next),
    white: { ...pace.white },
    black: { ...pace.black },
    history: pace.history.slice(),
    provisional: isProvisionalDeviation(next.deviation),
  };
  addResult(updated, score);
  addResult(color === 'b' ? updated.black : updated.white, score);
  updated.history.push({
    at,
    rating: next.rating,
    delta: shownAfter - shownBefore,
    score,
    opponent: opponent.rating,
    opponentName: opponentName || '',
    color: color === 'b' ? 'b' : 'w',
  });
  if (updated.history.length > MAX_RATING_HISTORY) updated.history = updated.history.slice(-MAX_RATING_HISTORY);
  return updated;
}
