// Progress statistics (#/stats): rating history, results by colour, bot level
// and opening, puzzle accuracy, and endgame completion.
import { mods } from './modules.js';
import { esc, formatDate } from './dom.js';
import { CORNER, DIVIDER } from './ornament.js';
import { START_RATING } from '../rating.js';
import { GLICKO_START_RATING, formatGlicko } from '../glicko.js';
import { PACE_LABEL, PACES } from '../online-ratings.js';
import { peakCell } from './rating-view.js';
import { refreshOnlineRatings } from './online-ratings-client.js';
import { ICONS } from './ornament.js';
import { readStats as readGeneratedStats } from './puzzle-gen-client.js';
import { ENDGAMES, ENDGAME_CATEGORIES } from '../data/endgames.js';
import { buildProgress } from '../progress-stats.js';
import { reviewStore } from '../review-storage.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;

function difficulties() {
  const list = (mods.ai && mods.ai.DIFFICULTIES) || [];
  return list.length ? list : [];
}

function loadSavedRecords() {
  const st = mods.storage;
  const list = st.listGames ? st.listGames() : [];
  const out = [];
  for (const item of list) {
    try {
      const rec = st.loadGame(item.id);
      if (rec) out.push(rec);
    } catch { /* skip a damaged save */ }
  }
  return out;
}

function collect() {
  const st = mods.storage;
  let generated = { solved: 0, attempted: 0, byLevel: {} };
  try { generated = readGeneratedStats(); } catch { /* storage blocked */ }
  let endgameProgress = { positions: {} };
  try { endgameProgress = st.getEndgameProgress ? st.getEndgameProgress() : endgameProgress; } catch { /* ignore */ }
  let mistakes = [];
  try { mistakes = reviewStore().listMistakes(); } catch { /* storage blocked */ }
  const Game = mods.engine && mods.engine.Game;
  const identify = mods.openings && mods.openings.identifyOpeningForGame;
  return buildProgress({
    playerRating: null,
    startRating: START_RATING,
    stats: st.getStats ? (st.getStats() || {}) : {},
    difficulties: difficulties(),
    savedRecords: loadSavedRecords(),
    Game,
    identifyOpeningForGame: identify,
    puzzles: (mods.puzzleData && mods.puzzleData.PUZZLES) || [],
    puzzleProgress: st.getPuzzleProgress ? st.getPuzzleProgress() : { puzzles: {} },
    generatedStats: generated,
    endgames: ENDGAMES,
    endgameCategories: ENDGAME_CATEGORIES,
    endgameProgress,
    mistakes,
  });
}

function wdl(b) {
  return `${b.wins} / ${b.draws} / ${b.losses}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortWhen(ms, withTime) {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return '';
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  if (!withTime) return day;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${hh}:${mm}`;
}

function groupedDayLabels(coords, width, height, textFor) {
  const groups = [];
  for (const c of coords) {
    const text = textFor(c);
    const prev = groups[groups.length - 1];
    if (prev && prev.text === text) prev.xs.push(c.x);
    else groups.push({ text, xs: [c.x] });
  }
  const collapsed = groups.map((group, index) => ({
    i: index,
    x: Math.max(40, Math.min(width - 40, group.xs.reduce((sum, x) => sum + x, 0) / group.xs.length)),
    text: group.text,
  }));
  const labels = [];
  for (const c of collapsed) {
    const prev = labels[labels.length - 1];
    if (!prev) { labels.push(c); continue; }
    if (c.x - prev.x < 78) {
      if (c.i === collapsed.length - 1) {
        while (labels.length && c.x - labels[labels.length - 1].x < 78) labels.pop();
        labels.push(c);
      }
      continue;
    }
    labels.push(c);
  }
  return labels.map((c) => `<text class="st-x" x="${c.x.toFixed(1)}" y="${height - 12}" text-anchor="middle">${esc(c.text)}</text>`).join('');
}

function axisLabels(coords, width, height, labelFor) {
  const labels = [];
  for (const c of coords) {
    const prev = labels[labels.length - 1];
    if (!prev) { labels.push(c); continue; }
    if (c.x - prev.x < 78) {
      if (c.i === coords.length - 1) {
        while (labels.length && c.x - labels[labels.length - 1].x < 78) labels.pop();
        labels.push(c);
      }
      continue;
    }
    labels.push(c);
  }
  return labels.map((c) => {
    const anchor = coords.length === 1 ? 'middle' : c.i === 0 ? 'start' : c.i === coords.length - 1 ? 'end' : 'middle';
    const xx = anchor === 'start' ? Math.max(4, c.x) : anchor === 'end' ? Math.min(width - 4, c.x) : c.x;
    return `<text class="st-x" x="${xx.toFixed(1)}" y="${height - 12}" text-anchor="${anchor}">${esc(labelFor(c))}</text>`;
  }).join('');
}

/** One point per calendar day: the average rating of the games played that day. */
function dailyAverages(history) {
  const buckets = new Map();
  history.forEach((item, index) => {
    if (!item || !Number.isFinite(item.rating)) return;
    const dated = Number.isFinite(item.at);
    const date = dated ? new Date(item.at) : null;
    const key = dated ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : `undated-${index}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { at: dated ? item.at : null, sum: 0, n: 0, order: buckets.size };
      buckets.set(key, bucket);
    }
    bucket.sum += item.rating;
    bucket.n += 1;
    if (dated && item.at < bucket.at) bucket.at = item.at;
  });
  return [...buckets.values()]
    .sort((a, b) => {
      if (a.at == null && b.at == null) return a.order - b.order;
      if (a.at == null) return 1;
      if (b.at == null) return -1;
      return a.at - b.at;
    })
    .map((bucket) => {
      const rating = Math.round(bucket.sum / bucket.n);
      const games = `${bucket.n} ${bucket.n === 1 ? 'game' : 'games'}`;
      const when = Number.isFinite(bucket.at) ? shortWhen(bucket.at, false) : '';
      return {
        rating,
        at: bucket.at,
        games: bucket.n,
        title: when ? `Average rating on ${when} was ${rating}, across ${games}.` : `Average rating was ${rating}, across ${games}.`,
      };
    });
}

/** Rating on each day, placed by the date. Points are not coloured by the result. */
function lineChart(points, { width = 640, height = 220, ariaLabel = 'Rating chart' } = {}) {
  if (!points || !points.length) return '';
  const vals = points.map((p) => p.rating);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 40) { const mid = (hi + lo) / 2; lo = mid - 20; hi = mid + 20; }
  const padL = 58, padR = 16, padT = 16, padB = 36;
  const dated = points.filter((p) => Number.isFinite(p.at));
  const span = dated.length >= 2 ? dated[dated.length - 1].at - dated[0].at : 0;
  const ordered = dated.every((p, i) => i === 0 || p.at >= dated[i - 1].at);
  const byTime = ordered && span > 0 && dated.length === points.length;
  const minT = dated.length ? dated[0].at : 0;
  const innerL = padL;
  const innerR = width - padR;
  const x = (p, i) => {
    if (!byTime || points.length < 2) {
      if (points.length === 1) return (innerL + innerR) / 2;
      return innerL + (i * (innerR - innerL)) / (points.length - 1);
    }
    return innerL + ((p.at - minT) / span) * (innerR - innerL);
  };
  const y = (v) => padT + ((hi - v) * (height - padT - padB)) / (hi - lo);
  const coords = points.map((p, i) => ({ p, i, x: x(p, i), y: y(p.rating) }));
  const line = coords.length > 1 ? coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ') : '';
  const area = line ? `${line} L${coords[coords.length - 1].x.toFixed(1)} ${height - padB} L${coords[0].x.toFixed(1)} ${height - padB} Z` : '';
  const ticks = [...new Set([Math.round(lo), Math.round((lo + hi) / 2), Math.round(hi)])];
  const grid = ticks.map((v) => {
    const yy = y(v).toFixed(1);
    return `<line class="st-grid" x1="${padL}" x2="${width - padR}" y1="${yy}" y2="${yy}"/><text class="st-tick" x="${padL - 8}" y="${yy}" dy="0.35em" text-anchor="end">${v}</text>`;
  }).join('');
  const origin = GLICKO_START_RATING;
  const base = origin >= lo && origin <= hi ? `<line class="st-base" x1="${padL}" x2="${width - padR}" y1="${y(origin).toFixed(1)}" y2="${y(origin).toFixed(1)}"/>` : '';
  const xLabels = axisLabels(coords, width, height, (c) => (Number.isFinite(c.p.at) ? shortWhen(c.p.at, false) : `Day ${c.i + 1}`));
  const dots = coords.map((c) => `<circle class="st-dot" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5"><title>${esc(c.p.title || `Average rating ${Math.round(c.p.rating)}.`)}</title></circle>`).join('');
  return `<svg class="st-svg st-line" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}" focusable="false">
    <rect class="st-bg" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="3"/>
    ${grid}${base}
    ${area ? `<path class="st-area" d="${area}"/>` : ''}
    ${line ? `<path class="st-path" d="${line}" vector-effect="non-scaling-stroke"/>` : ''}
    ${dots}
    ${xLabels}
  </svg>`;
}

function resultKey() {
  return `<div class="st-keyline"><span class="st-key-name">Key</span><ul class="st-key">
    <li><span class="st-swatch win" aria-hidden="true"></span> Win</li>
    <li><span class="st-swatch draw" aria-hidden="true"></span> Draw</li>
    <li><span class="st-swatch loss" aria-hidden="true"></span> Loss</li>
  </ul></div>`;
}

/** Wins count upward and losses count downward. A draw returns the streak to zero. */
function streakPoints(history) {
  const indexed = history.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    const aa = Number.isFinite(a.item.at) ? a.item.at : Infinity;
    const bb = Number.isFinite(b.item.at) ? b.item.at : Infinity;
    return aa - bb || a.index - b.index;
  });
  let streak = 0;
  const out = [];
  for (const { item } of indexed) {
    let kind = null;
    if (item.score === 1) { streak = streak > 0 ? streak + 1 : 1; kind = 'win'; }
    else if (item.score === 0) { streak = streak < 0 ? streak - 1 : -1; kind = 'loss'; }
    else if (item.score === 0.5) { streak = 0; kind = 'draw'; }
    else continue;
    const name = kind === 'win' ? 'Win' : kind === 'loss' ? 'Loss' : 'Draw';
    const detail = kind === 'draw' ? 'The streak returned to zero.' : kind === 'win' ? `The win streak is ${streak}.` : `The loss streak is ${Math.abs(streak)}.`;
    const when = Number.isFinite(item.at) ? ` ${formatDate(item.at)}.` : '';
    out.push({ streak, kind, at: Number.isFinite(item.at) ? item.at : null, title: `${name}.${when} ${detail}` });
  }
  return out;
}

function streakChart(points, { width = 640, height = 180, ariaLabel = 'Streak chart' } = {}) {
  if (!points.length) return '';
  let lo = 0;
  let hi = 0;
  for (const p of points) { lo = Math.min(lo, p.streak); hi = Math.max(hi, p.streak); }
  if (hi - lo < 2) { hi += 1; lo -= 1; }
  const padL = 42, padR = 16, padT = 14, padB = 34;
  const y = (v) => padT + ((hi - v) * (height - padT - padB)) / (hi - lo);
  const innerL = padL;
  const innerR = width - padR;
  const slot = (innerR - innerL) / points.length;
  const barW = Math.max(3, Math.min(18, slot * 0.62));
  const coords = points.map((p, i) => ({ p, i, x: innerL + slot * (i + 0.5), y: y(p.streak) }));
  const ticks = [...new Set([lo, 0, hi])];
  const grid = ticks.map((v) => {
    const yy = y(v).toFixed(1);
    return `<line class="st-grid" x1="${padL}" x2="${width - padR}" y1="${yy}" y2="${yy}"/><text class="st-tick" x="${padL - 8}" y="${yy}" dy="0.35em" text-anchor="end">${v}</text>`;
  }).join('');
  const zero = y(0);
  const bars = coords.map((c) => {
    if (c.p.kind === 'draw') {
      const size = Math.max(9, barW);
      return `<rect class="st-flat" x="${(c.x - size / 2).toFixed(1)}" y="${(zero - size / 2).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="2"><title>${esc(c.p.title)}</title></rect>`;
    }
    const top = Math.min(zero, c.y);
    const h = Math.max(2, Math.abs(c.y - zero));
    const cls = c.p.kind === 'loss' ? 'st-down' : 'st-up';
    return `<rect class="${cls}" x="${(c.x - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(c.p.title)}</title></rect>`;
  }).join('');
  const xLabels = groupedDayLabels(coords, width, height, (c) => (Number.isFinite(c.p.at) ? shortWhen(c.p.at, false) : `Game ${c.i + 1}`));
  return `<svg class="st-svg st-streak" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}" focusable="false">
    <rect class="st-bg" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="3"/>
    ${grid}
    <line class="st-base" x1="${padL}" x2="${width - padR}" y1="${zero.toFixed(1)}" y2="${zero.toFixed(1)}"/>
    ${bars}
    ${xLabels}
  </svg>`;
}

function stackedBars(rows, { ariaLabel = 'Results chart' } = {}) {
  const used = rows.filter((r) => r.games > 0);
  if (!used.length) return '';
  const max = Math.max(...used.map((r) => r.games));
  const body = used.map((r) => {
    const label = r.name || r.label;
    const scale = max ? (r.games / max) * 100 : 0;
    const w = r.games ? (r.wins / r.games) * scale : 0;
    const d = r.games ? (r.draws / r.games) * scale : 0;
    const l = r.games ? (r.losses / r.games) * scale : 0;
    return `<div class="st-barrow">
      <div class="st-bar-head"><span class="st-bar-name">${esc(label)}</span><span class="st-bar-val">${r.wins} / ${r.draws} / ${r.losses}</span></div>
      <div class="st-bar-track" aria-hidden="true"><span class="st-win" style="width:${w.toFixed(1)}%"></span><span class="st-draw" style="width:${d.toFixed(1)}%"></span><span class="st-loss" style="width:${l.toFixed(1)}%"></span></div>
    </div>`;
  }).join('');
  return `<div class="st-barlist" role="img" aria-label="${esc(ariaLabel)}">${body}</div>`;
}

function percentBars(rows, { ariaLabel = 'Accuracy chart' } = {}) {
  const used = rows.filter((r) => r.attempted > 0 || r.total > 0);
  if (!used.length) return '';
  const body = used.map((r) => {
    const label = r.name || r.label;
    const ratio = r.total ? r.completed / r.total : (typeof r.accuracyPct === 'number' ? r.accuracyPct / 100 : 0);
    const pct = Math.max(0, Math.min(100, ratio * 100));
    const val = r.total != null && r.completed != null
      ? `${r.completed} of ${r.total}`
      : (r.accuracyPct == null ? `${r.solved} / ${r.attempted}` : `${r.accuracyPct}%`);
    return `<div class="st-barrow">
      <div class="st-bar-head"><span class="st-bar-name">${esc(label)}</span><span class="st-bar-val">${esc(val)}</span></div>
      <div class="st-bar-track" aria-hidden="true"><span class="st-fill" style="width:${pct.toFixed(1)}%"></span></div>
    </div>`;
  }).join('');
  return `<div class="st-barlist" role="img" aria-label="${esc(ariaLabel)}">${body}</div>`;
}

function frame(title, id, inner) {
  return `<section class="frame st-section" aria-labelledby="${id}">${fc}<div class="frame-inner">
    <h2 id="${id}">${esc(title)}</h2>
    ${inner}
  </div></section>`;
}

function paceBlock(pace, record) {
  const label = PACE_LABEL[pace];
  const colours = record.white.games + record.black.games;
  return `<section class="pace-card" data-pace="${pace}">
    <h3>${ICONS[pace] || ''}<span>${esc(label)}</span></h3>
    <dl class="stat-grid">
      <div><dt>Current rating</dt><dd>${esc(formatGlicko(record.rating, record.deviation))}</dd></div>
      <div><dt>Rated games</dt><dd>${record.games}</dd></div>
      <div><dt>Peak rating</dt><dd>${peakCell(record)}</dd></div>
      <div><dt>Wins, draws and losses</dt><dd>${record.wins} / ${record.draws} / ${record.losses}</dd></div>
    </dl>
    ${colours ? `<h3 class="small">By the colour you played</h3>${stackedBars([{ name: 'White', ...record.white }, { name: 'Black', ...record.black }], { ariaLabel: `${label} wins, draws and losses as White and as Black.` })}` : ''}
    ${record.history.length ? '' : `<p class="muted st-empty">No ${label.toLowerCase()} games have been rated yet. This rating starts at ${GLICKO_START_RATING}.</p>`}
  </section>`;
}

function ratingCaption(label, days) {
  const name = label.toLowerCase();
  const games = days.reduce((sum, day) => sum + day.games, 0);
  const gameWord = games === 1 ? 'game' : 'games';
  if (days.length === 1) {
    const when = Number.isFinite(days[0].at) ? `On ${shortWhen(days[0].at, false)}, the` : 'The';
    return `${when} average ${name} rating was ${days[0].rating}, across ${games} ${gameWord}. Each point is the average rating of the games played on that day.`;
  }
  const first = days[0];
  const last = days[days.length - 1];
  const from = Number.isFinite(first.at) ? ` on ${shortWhen(first.at, false)}` : '';
  const to = Number.isFinite(last.at) ? ` on ${shortWhen(last.at, false)}` : '';
  return `Each point is the average rating of the games played on that day. The average ${name} rating was ${first.rating}${from} and ${last.rating}${to}, across ${games} ${gameWord}.`;
}

function streakCaption(points) {
  const bestWin = points.reduce((best, point) => (point.kind === 'win' ? Math.max(best, point.streak) : best), 0);
  const bestLoss = points.reduce((best, point) => (point.kind === 'loss' ? Math.max(best, Math.abs(point.streak)) : best), 0);
  const winText = bestWin ? `The longest win streak is ${bestWin} ${bestWin === 1 ? 'game' : 'games'}.` : 'There is no win streak.';
  const lossText = bestLoss ? `The longest loss streak is ${bestLoss} ${bestLoss === 1 ? 'game' : 'games'}.` : 'There is no loss streak.';
  return `Each bar is one rated game, in the order played. A run of wins counts upward and a run of losses counts downward. A draw returns the streak to zero. ${winText} ${lossText}`;
}

function ratingCharts(doc) {
  const blocks = PACES.map((pace) => {
    const record = doc[pace];
    if (!record.history.length) return '';
    const label = PACE_LABEL[pace];
    const days = dailyAverages(record.history);
    const streak = streakPoints(record.history);
    if (!days.length) return '';
    const first = days[0];
    const last = days[days.length - 1];
    const aria = days.length === 1
      ? `${label} rating over time. The average on the only day was ${first.rating}.`
      : `${label} rating over time. The daily average moved from ${first.rating} to ${last.rating}.`;
    const bestWin = streak.reduce((best, point) => (point.kind === 'win' ? Math.max(best, point.streak) : best), 0);
    const streakAria = `${label} streak. The longest win streak is ${bestWin} ${bestWin === 1 ? 'game' : 'games'}.`;
    const streakFigure = streak.length ? `<figure class="st-figure st-streak" data-pace="${pace}">
      <h3 class="small">${esc(label)} streak</h3>
      ${streakChart(streak, { ariaLabel: streakAria })}
      ${resultKey()}
      <figcaption class="help">${esc(streakCaption(streak))}</figcaption>
    </figure>` : '';
    return `<figure class="st-figure st-time" data-pace="${pace}">
      <h3 class="small">${esc(label)} over time</h3>
      ${lineChart(days, { ariaLabel: aria })}
      <figcaption class="help">${esc(ratingCaption(label, days))}</figcaption>
    </figure>${streakFigure}`;
  }).filter(Boolean);
  if (!blocks.length) return '<p class="muted st-empty">A rating chart and a streak chart appear here after the first rated game in that category.</p>';
  return `<div class="st-rating-charts">${blocks.join('')}</div>`;
}

export async function render(root) {
  const onlineRatings = await refreshOnlineRatings();
  const data = collect();
  const hasGames = data.totals.games > 0 || data.byColor.w.games + data.byColor.b.games > 0 || data.byLevel.some((l) => l.games);
  const hasOpenings = data.byOpening.length > 0;
  const hasCurated = data.curated.attempted > 0;
  const hasGenerated = data.generated.attempted > 0;
  const hasMistakes = data.mistakes.attempted > 0;
  const hasEndgames = data.endgames.attempted > 0 || data.endgames.completed > 0;

  const colorRows = [
    { name: 'White', ...data.byColor.w },
    { name: 'Black', ...data.byColor.b },
  ];
  const levelRows = data.byLevel.filter((l) => l.games > 0);
  const openingRows = data.byOpening.slice(0, 16);

  root.innerHTML = `
    <h1 class="page-title" id="title-stats">Progress statistics</h1>
    <p class="lede">This page summarises your online bullet, blitz and rapid ratings, your results against the bot, your accuracy in the curated, generated and My mistakes puzzle modes, and the endgame positions you have completed. Online ratings are kept with your account. The other figures are stored on this device.</p>
    ${DIVIDER}
    ${frame('Online ratings', 'st-rating', `
      <p class="help">Each category has its own rating and record. The rating chart marks the average rating for each day you played, and the streak chart shows wins, draws and losses. A question mark means the rating is provisional while the deviation is above 110. The peak stays empty until the rating is stable. A game against the bot is not included.</p>
      <div class="pace-ratings">${PACES.map((pace) => paceBlock(pace, onlineRatings[pace])).join('')}</div>
      ${ratingCharts(onlineRatings)}
    `)}
    ${DIVIDER}
    ${frame('Results by colour and by bot level', 'st-results', hasGames ? `
      <h3 class="small">By the colour you played</h3>
      ${data.byColor.w.games + data.byColor.b.games ? stackedBars(colorRows, { ariaLabel: 'Wins, draws and losses when playing White and when playing Black.' }) : `<p class="muted">Wins, draws and losses by colour will appear here after you finish a game against the bot. Games played before this summary was added are included only if they were saved.</p>`}
      <h3 class="small">By bot level</h3>
      ${levelRows.length ? stackedBars(levelRows, { ariaLabel: 'Wins, draws and losses at each bot level.' }) : `<p class="muted">Results by bot level will appear here after you finish a game against the bot.</p>`}
      <p class="help">In the charts, gold marks wins, ivory marks draws, and copper marks losses. The numbers after each bar are wins, draws and losses.</p>
    ` : `<p class="muted st-empty">No games against the bot have been recorded yet. After you finish a game on the Play page, the result is stored by the colour you played and by the bot level, and will appear here.</p>`)}
    ${DIVIDER}
    ${frame('Results by opening', 'st-openings', hasOpenings ? `
      <p class="help">These figures combine the results recorded when a game against the bot finished with the finished bot games stored in the saved games library, grouped by the named opening that the game reached. A game that appears in both sources is counted once. A review of a finished game does not add a second result. Games that left the book without matching a named opening are listed at the end.</p>
      ${stackedBars(openingRows.map((o) => ({ name: o.eco ? `${o.eco} ${o.name}` : o.name, ...o })), { ariaLabel: 'Wins, draws and losses against the bot, grouped by opening.' })}
    ` : `<p class="muted st-empty">Opening results appear after you finish a game against the bot, or after you store a finished bot game in the saved games library. They are grouped by the named opening that the game reached, and a game that is both recorded and saved is counted only once.</p>`)}
    ${DIVIDER}
    ${frame('Puzzle accuracy', 'st-puzzles', `
      <h3 class="small">Curated puzzles</h3>
      ${hasCurated ? `<p>You have solved ${data.curated.solved} of ${data.curated.attempted} attempted curated puzzles${data.curated.accuracyPct != null ? `, which is an accuracy of ${data.curated.accuracyPct} percent` : ''}. There are ${data.curated.total} curated puzzles in the collection.</p>
        ${percentBars(data.curated.levels, { ariaLabel: 'Curated puzzle accuracy by difficulty level.' })}` : `<p class="muted">Accuracy for the curated puzzles will appear here after you attempt a puzzle in that collection. The figure is the number of puzzles solved divided by the number attempted, grouped by difficulty level.</p>`}
      <h3 class="small">Generated puzzles</h3>
      ${hasGenerated ? `<p>You have solved ${data.generated.solved} of ${data.generated.attempted} attempted generated puzzles${data.generated.accuracyPct != null ? `, which is an accuracy of ${data.generated.accuracyPct} percent` : ''}.</p>
        ${percentBars(data.generated.levels, { ariaLabel: 'Generated puzzle accuracy by easy, medium and hard levels.' })}` : `<p class="muted">Accuracy for generated puzzles will appear here after you attempt a puzzle that this device has created. The figure is grouped by the easy, medium and hard levels.</p>`}
      <h3 class="small">My mistakes</h3>
      ${hasMistakes ? `<p>You have solved ${data.mistakes.solved} of ${data.mistakes.attempted} attempted puzzles from your own mistakes${data.mistakes.accuracyPct != null ? `, which is an accuracy of ${data.mistakes.accuracyPct} percent` : ''}. There ${data.mistakes.total === 1 ? 'is 1 such puzzle' : `are ${data.mistakes.total} such puzzles`} stored on this device.</p>` : `<p class="muted">Accuracy for puzzles from your own mistakes will appear here after you attempt a position on the My mistakes page. Those positions are taken from a post-game review, and a review does not add a second game result on this page.</p>`}
    `)}
    ${DIVIDER}
    ${frame('Endgame practice', 'st-endgames', hasEndgames ? `
      <p>You have completed ${data.endgames.completed} of ${data.endgames.total} endgame positions.</p>
      ${percentBars(data.endgames.groups, { ariaLabel: 'Endgame positions completed in each group.', valueKey: 'completed' })}
    ` : `<p class="muted st-empty">Endgame completion will appear here after you finish a practice position on the Endgames page. Completion is stored on this device for each position.</p>`)}
  `;
}

export default { render };
