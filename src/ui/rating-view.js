// Online rating presentation: the Home panel, the sparkline, and the sentences
// used when an online game finishes. Bot games are not rated.
import { esc } from './dom.js';
import { START_RATING, formatRating, formatDelta, isProvisional } from '../rating.js';
import { GLICKO_START_RATING, PROVISIONAL_DEVIATION, formatGlicko } from '../glicko.js';
import { ICONS } from './ornament.js';
import { PACE_LABEL, PACES, normalizeOnlineRatings, stablePeak } from '../online-ratings.js';

export const RATING_DISCLAIMER = 'These are Glicko-2 ratings from online games in this app. They are not Chess.com, Lichess or FIDE ratings. A game against the bot does not change them.';
export const PROVISIONAL_NOTE = `A question mark after a rating means that it is provisional while its deviation is above ${PROVISIONAL_DEVIATION}. The peak counts only a stable rating, so it stays empty until the question mark is gone.`;

export function blankRating() {
  return { rating: START_RATING, games: 0, wins: 0, draws: 0, losses: 0, peak: START_RATING, history: [], provisional: true };
}

export function readRating(storage) {
  try { return storage && storage.getPlayerRating ? storage.getPlayerRating() : blankRating(); } catch { return blankRating(); }
}

/** SVG line chart of the rating after each rated game, starting from 1200. */
function historyRatings(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (const h of history) {
    if (!h || typeof h !== 'object') continue;
    const v = h.rating;
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function ratingSparkline(history, { width = 320, height = 72, start = START_RATING } = {}) {
  const pts = [start, ...historyRatings(history)];
  if (pts.length < 2) return '';
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (hi - lo < 40) { const mid = (hi + lo) / 2; lo = mid - 20; hi = mid + 20; }
  const pad = 6;
  const x = (i) => pad + (i * (width - 2 * pad)) / (pts.length - 1);
  const y = (v) => pad + ((hi - v) * (height - 2 * pad)) / (hi - lo);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${height - pad} L${x(0).toFixed(1)} ${height - pad} Z`;
  const last = pts[pts.length - 1];
  const label = `Rating history chart for ${pts.length - 1} rated ${pts.length === 2 ? 'game' : 'games'}. The rating started at ${pts[0]}, ranged from ${Math.min(...pts)} to ${Math.max(...pts)}, and is now ${last}.`;
  const base = start >= lo && start <= hi ? `<line class="rs-base" x1="${pad}" x2="${width - pad}" y1="${y(start).toFixed(1)}" y2="${y(start).toFixed(1)}"/>` : '';
  return `<svg class="rating-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}" focusable="false">
    <rect class="rs-bg" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="3"/>${base}
    <path class="rs-area" d="${area}"/><path class="rs-line" d="${line}" vector-effect="non-scaling-stroke"/>
    <path class="rs-dot" d="M${x(pts.length - 1).toFixed(1)} ${y(last).toFixed(1)} h0" vector-effect="non-scaling-stroke"/></svg>`;
}

export function peakCell(record) {
  const peak = stablePeak(record);
  if (peak == null) return '<span class="muted" aria-label="No stable rating yet">—</span>';
  return String(peak);
}

function paceCard(pace, record) {
  const label = PACE_LABEL[pace];
  const shown = formatGlicko(record.rating, record.deviation);
  const chart = record.history.length ? ratingSparkline(record.history, { start: GLICKO_START_RATING, height: 64 }) : '';
  return `<section class="pace-card" data-pace="${pace}">
    <h3>${ICONS[pace] || ''}<span>${esc(label)}</span></h3>
    <p class="rating-figure" aria-label="${esc(label)} rating ${Math.round(record.rating)}${record.provisional ? ', provisional' : ''}">${esc(shown)}</p>
    <dl class="stat-grid rating-stats">
      <div><dt>Rated games</dt><dd>${record.games}</dd></div>
      <div><dt>Wins, draws and losses</dt><dd>${record.wins} / ${record.draws} / ${record.losses}</dd></div>
      <div><dt>Peak</dt><dd>${peakCell(record)}</dd></div>
    </dl>
    ${chart ? `<figure class="rating-chart">${chart}</figure>` : `<p class="muted rating-empty">No ${label.toLowerCase()} games have been rated yet.</p>`}
  </section>`;
}

/** Inner HTML of the rating panel (Home page). doc is the three online ratings. */
export function ratingPanelHtml(doc) {
  const ratings = normalizeOnlineRatings(doc);
  const anyGames = PACES.some((pace) => ratings[pace].games > 0);
  return `
    <h2 id="rating-title">Your online ratings</h2>
    <p class="help">Bullet, blitz and rapid each have their own rating. A game against the bot does not change them.</p>
    <div class="pace-ratings">${PACES.map((pace) => paceCard(pace, ratings[pace])).join('')}</div>
    ${anyGames ? '' : `<p class="muted rating-empty">Every rating starts at ${GLICKO_START_RATING}. The chart for a category appears after its first rated game.</p>`}
    <p class="help">${esc(PROVISIONAL_NOTE)}</p>
    <p class="help rating-disclaimer">${esc(RATING_DISCLAIMER)}</p>`;
}

/** Sentence for the setup form below the Rated toggle. */
export function setupRatedText(on, r, level) {
  if (!on) return 'This game will not be rated because the Rated option is turned off.';
  const lvl = level && Number.isFinite(level.elo) ? ` against the ${level.name} level, which is rated about ${level.elo}` : '';
  return `This game will be rated. Your current rating is ${formatRating(r.rating, r.games)}, and it will change after the game according to your result${lvl}.`;
}

/** HTML for the game-over dialog. outcome: { rated, text, before, after, delta, games } */
export function ratingChangeHtml(outcome) {
  if (!outcome) return '';
  if (!outcome.rated) return `<p class="rating-change-note">${esc(outcome.text)}</p>`;
  const dir = outcome.delta > 0 ? 'up' : outcome.delta < 0 ? 'down' : 'same';
  const now = formatRating(outcome.after, outcome.games);
  return `<div class="rating-change ${dir}"><span class="rc-label">Rating:</span> <span class="rc-figure">${esc(now)}</span> <span class="rc-delta">(${esc(formatDelta(outcome.delta))})</span></div>
    <p class="rating-change-note">Your rating changed from ${Math.round(outcome.before)} to ${Math.round(outcome.after)} after this rated game.${isProvisional(outcome.games) ? ` ${esc(PROVISIONAL_NOTE)}` : ''}</p>`;
}
