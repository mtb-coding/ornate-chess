/**
 * Aggregation of player progress for the Stats page. Pure functions only
 * (no DOM, no localStorage), so Node tests can import them. Callers pass
 * already-loaded storage snapshots, puzzle lists and saved games.
 */

export function emptyBucket() {
  return { wins: 0, draws: 0, losses: 0, games: 0 };
}

export function cloneBucket(b) {
  const s = emptyBucket();
  if (!b || typeof b !== 'object') return s;
  for (const k of ['wins', 'draws', 'losses', 'games']) {
    const n = b[k];
    s[k] = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1e9) : 0;
  }
  if (s.games < s.wins + s.draws + s.losses) s.games = s.wins + s.draws + s.losses;
  return s;
}

export function addOutcome(bucket, outcome) {
  const b = cloneBucket(bucket);
  if (outcome === 'wins' || outcome === 'draws' || outcome === 'losses') {
    b[outcome] += 1;
    b.games += 1;
  }
  return b;
}

/** 'wins' | 'draws' | 'losses' | null from a game result and the player's colour. */
export function outcomeFromResult(result, playerColor) {
  if (result === '1/2-1/2') return 'draws';
  if (result !== '1-0' && result !== '0-1') return null;
  if (playerColor !== 'w' && playerColor !== 'b') return null;
  return (result === '1-0') === (playerColor === 'w') ? 'wins' : 'losses';
}

function count(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 1e9) : 0;
}

function accuracy(solved, attempted) {
  if (!attempted) return null;
  return solved / attempted;
}

function formatPct(ratio) {
  if (ratio == null) return null;
  return Math.round(ratio * 1000) / 10; // one decimal, e.g. 66.7
}

/** Curated puzzle accuracy, grouped by difficulty (1-5). */
export function curatedPuzzleAccuracy(puzzles, progress) {
  const list = Array.isArray(puzzles) ? puzzles : [];
  const rec = progress && typeof progress === 'object' && progress.puzzles && typeof progress.puzzles === 'object' ? progress.puzzles : {};
  const by = { 1: { solved: 0, attempted: 0, total: 0 }, 2: { solved: 0, attempted: 0, total: 0 }, 3: { solved: 0, attempted: 0, total: 0 }, 4: { solved: 0, attempted: 0, total: 0 }, 5: { solved: 0, attempted: 0, total: 0 } };
  let solved = 0, attempted = 0;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const d = [1, 2, 3, 4, 5].includes(p.difficulty) ? p.difficulty : null;
    if (d) by[d].total += 1;
    const st = rec[p.id];
    if (!st || typeof st !== 'object') continue;
    const solvedFlag = st.solved === true;
    const tried = !!(solvedFlag || count(st.attempts) > 0);
    if (!tried) continue;
    attempted += 1;
    if (d) by[d].attempted += 1;
    if (solvedFlag) {
      solved += 1;
      if (d) by[d].solved += 1;
    }
  }
  const levels = [1, 2, 3, 4, 5].map((d) => ({
    level: d,
    label: `Level ${d}`,
    solved: by[d].solved,
    attempted: by[d].attempted,
    total: by[d].total,
    accuracy: accuracy(by[d].solved, by[d].attempted),
    accuracyPct: formatPct(accuracy(by[d].solved, by[d].attempted)),
  }));
  return { solved, attempted, total: list.length, accuracy: accuracy(solved, attempted), accuracyPct: formatPct(accuracy(solved, attempted)), levels };
}

/** Generated-puzzle accuracy, grouped by easy / medium / hard. */
export function generatedPuzzleAccuracy(stats) {
  const levels = ['easy', 'medium', 'hard'];
  const src = stats && typeof stats === 'object' && !Array.isArray(stats) ? stats : {};
  const by = src.byLevel && typeof src.byLevel === 'object' ? src.byLevel : {};
  const out = levels.map((id) => {
    const row = by[id] && typeof by[id] === 'object' ? by[id] : {};
    const attempted = count(row.attempted);
    const solved = Math.min(count(row.solved), attempted);
    return { level: id, label: id === 'easy' ? 'Easy' : id === 'medium' ? 'Medium' : 'Hard', solved, attempted, accuracy: accuracy(solved, attempted), accuracyPct: formatPct(accuracy(solved, attempted)) };
  });
  const attempted = out.reduce((n, r) => n + r.attempted, 0) || count(src.attempted);
  const solved = out.reduce((n, r) => n + r.solved, 0) || Math.min(count(src.solved), attempted);
  return { solved, attempted, streak: count(src.streak), best: count(src.best), accuracy: accuracy(solved, attempted), accuracyPct: formatPct(accuracy(solved, attempted)), levels: out };
}

/** Endgame completion overall and by category. */
export function endgameCompletion(endgames, categories, progress) {
  const list = Array.isArray(endgames) ? endgames : [];
  const cats = Array.isArray(categories) ? categories : [];
  const rec = progress && typeof progress === 'object' && progress.positions && typeof progress.positions === 'object' ? progress.positions : {};
  const done = (id) => !!(rec[id] && rec[id].completed === true);
  const groups = cats.map((c) => {
    const items = list.filter((e) => e && e.category === c.id);
    const completed = items.filter((e) => done(e.id)).length;
    return { id: c.id, name: c.name, total: items.length, completed };
  });
  const completed = list.filter((e) => e && done(e.id)).length;
  const attempted = list.filter((e) => e && rec[e.id] && (rec[e.id].completed === true || count(rec[e.id].attempts) > 0)).length;
  return { completed, attempted, total: list.length, groups };
}

/** Wins, draws and losses by bot level, using stored stats.byLevel. */
export function resultsByLevel(stats, difficulties) {
  const st = stats && typeof stats === 'object' ? stats : {};
  const by = st.byLevel && typeof st.byLevel === 'object' ? st.byLevel : {};
  const diffs = Array.isArray(difficulties) ? difficulties : [];
  const seen = new Set();
  const rows = [];
  for (const d of diffs) {
    if (!d || !d.id) continue;
    seen.add(d.id);
    const b = cloneBucket(by[d.id]);
    rows.push({ id: d.id, name: d.name || d.id, ...b });
  }
  for (const [id, raw] of Object.entries(by)) {
    if (seen.has(id)) continue;
    const b = cloneBucket(raw);
    if (!b.games) continue;
    rows.push({ id, name: id, ...b });
  }
  return rows;
}

/** Wins, draws and losses by the player's colour.
 * Uses stats.byColor when it has been recorded. If that record is empty,
 * finished bot games from the saved library are used instead, so older
 * games are not silently dropped.
 */
export function resultsByColor(stats, savedRecords) {
  const st = stats && typeof stats === 'object' ? stats : {};
  const raw = st.byColor && typeof st.byColor === 'object' ? st.byColor : {};
  const by = { w: cloneBucket(raw.w), b: cloneBucket(raw.b) };
  if (by.w.games + by.b.games > 0) return by;
  const records = Array.isArray(savedRecords) ? savedRecords : [];
  for (const rec of records) {
    if (!rec || rec.mode !== 'bot') continue;
    const color = rec.playerColor === 'b' ? 'b' : rec.playerColor === 'w' ? 'w' : null;
    if (!color) continue;
    const result = rec.game && rec.game.resultInfo && rec.game.resultInfo.result;
    const outcome = outcomeFromResult(result, color);
    if (outcome) by[color] = addOutcome(by[color], outcome);
  }
  return by;
}

/**
 * Canonical key for an opening bucket: the ECO code when it is present,
 * otherwise a name-prefixed key. Using the ECO code means two labels for the
 * same opening (for example "Sicilian Defence" and "Sicilian Defense") are
 * counted together.
 */
export function openingStatsKey(opening, fallbackKey = '') {
  const eco = opening && typeof opening.eco === 'string' ? opening.eco.trim() : '';
  const name = opening && typeof opening.name === 'string' && opening.name.trim()
    ? opening.name.trim()
    : (typeof fallbackKey === 'string' ? fallbackKey.trim() : '');
  if (eco) return eco;
  if (name) return name.startsWith('name:') ? name : `name:${name}`;
  return '';
}

/**
 * Opening results from finished bot games in the saved-games library, merged
 * with stored stats.byOpening buckets. A game that appears in both sources is
 * counted once by subtracting, for each opening, the already-counted saved
 * wins, draws and losses from the stored bucket and adding only the remainder.
 * Only finished bot games with a player colour are taken from the library,
 * because those have a clear player result. A later review of a game does
 * not call recordResult and therefore cannot double-count here.
 */
export function resultsByOpening({ stats, savedRecords, Game, identifyOpeningForGame } = {}) {
  const map = new Map();
  const add = (name, eco, outcome) => {
    if (!outcome) return;
    const display = name || 'Other games (no named opening)';
    const key = openingStatsKey({ name: display, eco }) || 'name:Other games (no named opening)';
    const cur = map.get(key) || { name: display, eco: eco || '', ...emptyBucket() };
    if (name) cur.name = name;
    if (eco && !cur.eco) cur.eco = eco;
    const next = addOutcome(cur, outcome);
    map.set(key, { ...cur, ...next });
  };

  const records = Array.isArray(savedRecords) ? savedRecords : [];
  for (const rec of records) {
    if (!rec || rec.mode !== 'bot') continue;
    const playerColor = rec.playerColor === 'b' ? 'b' : rec.playerColor === 'w' ? 'w' : null;
    if (!playerColor) continue;
    const info = rec.game && rec.game.resultInfo;
    const result = info && info.result;
    const outcome = outcomeFromResult(result, playerColor);
    if (!outcome) continue;
    let opening = null;
    if (typeof identifyOpeningForGame === 'function' && Game && rec.game) {
      try {
        const game = Game.fromJSON(rec.game);
        opening = identifyOpeningForGame(game);
      } catch { opening = null; }
    }
    add(opening && opening.name ? opening.name : 'Other games (no named opening)', opening && opening.eco ? opening.eco : '', outcome);
  }

  const stored = stats && stats.byOpening && typeof stats.byOpening === 'object' ? stats.byOpening : {};
  // Normalise historical name-keyed buckets onto the ECO key when one is stored.
  const storedByKey = new Map();
  for (const [rawKey, raw] of Object.entries(stored)) {
    const b = cloneBucket(raw);
    if (!b.games) continue;
    const name = (raw && typeof raw.name === 'string' && raw.name) ? raw.name : rawKey;
    const eco = (raw && typeof raw.eco === 'string') ? raw.eco.trim() : '';
    const key = openingStatsKey({ name, eco }, rawKey);
    if (!key) continue;
    const cur = storedByKey.get(key) || { name, eco, ...emptyBucket() };
    if (name && !cur.name) cur.name = name;
    if (name && !cur.name.startsWith('name:')) cur.name = name;
    if (eco) cur.eco = eco;
    cur.wins += b.wins;
    cur.draws += b.draws;
    cur.losses += b.losses;
    cur.games = cur.wins + cur.draws + cur.losses;
    storedByKey.set(key, cur);
  }
  for (const [key, b] of storedByKey) {
    const cur = map.get(key) || { name: b.name, eco: b.eco, ...emptyBucket() };
    if (b.eco && !cur.eco) cur.eco = b.eco;
    if (b.name) cur.name = b.name;
    cur.wins += Math.max(0, b.wins - cur.wins);
    cur.draws += Math.max(0, b.draws - cur.draws);
    cur.losses += Math.max(0, b.losses - cur.losses);
    cur.games = cur.wins + cur.draws + cur.losses;
    map.set(key, cur);
  }

  return [...map.values()].filter((r) => r.games > 0).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

/** Accuracy for puzzles drawn from a player's own reviewed mistakes. */
export function mistakePuzzleAccuracy(list) {
  const items = Array.isArray(list) ? list : [];
  let solved = 0, attempted = 0;
  for (const p of items) {
    if (!p || typeof p !== 'object') continue;
    const solvedFlag = p.solved === true;
    const tried = !!(solvedFlag || count(p.attempts) > 0);
    if (!tried) continue;
    attempted += 1;
    if (solvedFlag) solved += 1;
  }
  return {
    solved,
    attempted,
    total: items.length,
    accuracy: accuracy(solved, attempted),
    accuracyPct: formatPct(accuracy(solved, attempted)),
  };
}

/**
 * Rating history points for a chart: the starting rating plus one point
 * after each stored rated game. Returns [] when there is no history.
 */
export function ratingSeries(playerRating, startRating = 1200) {
  const hist = playerRating && Array.isArray(playerRating.history) ? playerRating.history : [];
  const points = [];
  const start = Number.isFinite(startRating) ? startRating : 1200;
  if (!hist.length) return points;
  points.push({ at: null, rating: start, index: 0 });
  hist.forEach((h, i) => {
    if (!h || typeof h !== 'object' || !Number.isFinite(h.rating)) return;
    points.push({ at: Number.isFinite(h.at) ? h.at : null, rating: Math.round(h.rating), delta: Number.isFinite(h.delta) ? h.delta : null, index: i + 1 });
  });
  return points.length >= 2 ? points : [];
}

/** Combine every section the Stats page needs. */
/** Copy a player-rating record, keeping only non-negative integer counts. */
export function sanitizeRating(raw, startRating = 1200) {
  const start = Number.isFinite(startRating) ? startRating : 1200;
  const d = { rating: start, games: 0, wins: 0, draws: 0, losses: 0, peak: start, history: [], provisional: true };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const rating = typeof raw.rating === 'number' && Number.isFinite(raw.rating) ? Math.max(0, Math.min(4000, raw.rating)) : start;
  const peak = typeof raw.peak === 'number' && Number.isFinite(raw.peak) ? Math.max(0, Math.min(4000, raw.peak)) : start;
  const games = count(raw.games);
  return {
    rating,
    games,
    wins: count(raw.wins),
    draws: count(raw.draws),
    losses: count(raw.losses),
    peak,
    history: Array.isArray(raw.history) ? raw.history : [],
    provisional: raw.provisional === true || games < 10,
  };
}

export function buildProgress(input = {}) {
  const playerRating = sanitizeRating(input.playerRating, input.startRating);
  const stats = input.stats && typeof input.stats === 'object' ? input.stats : {};
  const totals = cloneBucket(stats.totals);
  return {
    playerRating,
    ratingPoints: ratingSeries(playerRating, input.startRating),
    totals,
    byColor: resultsByColor(stats, input.savedRecords),
    byLevel: resultsByLevel(stats, input.difficulties),
    byOpening: resultsByOpening({ stats, savedRecords: input.savedRecords, Game: input.Game, identifyOpeningForGame: input.identifyOpeningForGame }),
    curated: curatedPuzzleAccuracy(input.puzzles, input.puzzleProgress),
    generated: generatedPuzzleAccuracy(input.generatedStats),
    mistakes: mistakePuzzleAccuracy(input.mistakes),
    endgames: endgameCompletion(input.endgames, input.endgameCategories, input.endgameProgress),
  };
}
