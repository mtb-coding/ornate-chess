// GUI tests for post-game review and My mistakes (Puppeteer, headless Chrome).
// Run: node tests/gui-review.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './gui-static-server.mjs';
import { START_FEN } from '../src/engine.js';
import { buildReview, reviewFingerprint, REVIEW_DEPTH, JUDGMENT_LABELS } from '../src/review.js';
import { createReviewStore } from '../src/review-storage.js';
import { MemoryStorage } from '../src/storage.js';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER || '/workspace/.ptools/node_modules/puppeteer-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const problems = [];
let pass = 0, fail = 0;
page.on('console', (m) => { if (m.type() === 'error') problems.push(`[console.error] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) problems.push(`[http ${r.status()}] ${r.url()}`); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }
async function step(name, fn) { try { await fn(); } catch (err) { check(name, false, err.message.split('\n')[0]); } }
async function go(route) {
  await page.evaluate((r) => { location.hash = r; }, route);
  const id = route.replace(/^#\/?/, '').split('?')[0].split('/')[0] || 'home';
  await page.waitForFunction((id) => window.__chess && window.__chess.ready && window.__chess.page === id, { timeout: 30000 }, id);
  await sleep(300);
}
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());

// Real engine output for 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.d3 Nf6 5.Nc3 d6
// 6.Bg5 h6 7.Bh4 g5 8.O-O?? h5? 9.Nxg5, recorded with the bundled Stockfish
// at REVIEW_DEPTH by tools/record-review-fixture.mjs. The screenshots taken
// here therefore show genuine engine judgments: 8.O-O is a blunder (the h4
// bishop falls to ...gxh4), 8...h5 misses that win, and 9.Nxg5 is best.
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/italian-review-evals.json'), 'utf8')).games.castleMiss;
const UCI = FX.uci;
const EVALS = FX.evals;
const REVIEW = buildReview({
  startFen: START_FEN, uci: UCI, mode: 'local', depth: REVIEW_DEPTH,
  name: 'Practice game for review', evals: EVALS,
});
REVIEW.analyzedAt = 1700000000000;
const FINGERPRINT = reviewFingerprint(START_FEN, UCI, REVIEW_DEPTH);
const mem = new MemoryStorage();
const store = createReviewStore({ backend: mem });
store.saveReview(REVIEW);
const INDEX = mem.getItem('ornate-chess:reviews-index');
const REVIEW_JSON = mem.getItem(`ornate-chess:review:${FINGERPRINT}`);
const MISTAKES_JSON = mem.getItem('ornate-chess:mistake-puzzles');
const MISTAKE = store.listMistakes()[0];
check('the fixture review contains a personal puzzle', !!MISTAKE, MISTAKE ? MISTAKE.bestSan : 'none');
check('the fixture includes at least one flagged move', REVIEW.moves.some((m) => m.judgment === 'miss' || m.judgment === 'blunder' || m.judgment === 'mistake'));

const GAME_RECORD = {
  id: 'gui-review-game',
  name: 'Practice game for review',
  savedAt: 1700000000000,
  mode: 'local',
  game: { version: 1, startFen: START_FEN, uci: UCI, resultInfo: { result: '1-0', reason: 'resignation' } },
};

await page.setViewport({ width: 1280, height: 800 });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });

// ---- Empty My mistakes ----
await step('empty My mistakes', async () => {
  await go('#/puzzles/mistakes');
  const title = await text('.page-title');
  check('the My mistakes page has its own heading', title === 'My mistakes');
  const empty = await text('.empty-mistakes');
  check('the empty frame is short and points to saved games', /No positions yet/.test(empty) && /saved games/i.test(empty));
  const weaknesses = await page.$('[data-weaknesses]');
  check('Your weaknesses is omitted when there are no reviews or positions', !weaknesses);
  const tabs = await page.$$eval('.mode-tabs a', (a) => a.map((x) => ({ href: x.getAttribute('href'), current: x.getAttribute('aria-current'), text: x.textContent.trim() })));
  check('the puzzle tabs include My mistakes', tabs.length === 3 && tabs.some((t) => t.href === '#/puzzles/mistakes' && t.current === 'page'));
  await page.screenshot({ path: path.join(SHOTS, 'mistakes-empty-1280.png') });
});

// Seed review cache, mistakes and a saved game, then reload so storage is read fresh.
await page.evaluate(({ index, reviewKey, reviewJson, mistakesJson, game }) => {
  localStorage.setItem('ornate-chess:reviews-index', index);
  localStorage.setItem(reviewKey, reviewJson);
  localStorage.setItem('ornate-chess:mistake-puzzles', mistakesJson);
  localStorage.setItem('ornate-chess:games', JSON.stringify([game]));
}, {
  index: INDEX,
  reviewKey: `ornate-chess:review:${FINGERPRINT}`,
  reviewJson: REVIEW_JSON,
  mistakesJson: MISTAKES_JSON,
  game: GAME_RECORD,
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });

// ---- Saved games offers Review ----
await step('saved games review button', async () => {
  await go('#/saved');
  const btn = await page.$('.saved-item [data-act="review"]');
  check('a saved game with moves has a Review button', !!btn);
  await btn.click();
  await page.waitForFunction(() => window.__chess && window.__chess.page === 'review', { timeout: 30000 });
  await sleep(400);
  check('the Review button opens the review of that game', (await text('.page-title')) === 'Game review');
});

// ---- Cached review UI ----
await step('cached review display', async () => {
  await go('#/review/' + encodeURIComponent(GAME_RECORD.id));
  await sleep(200);
  // pendingLoad may be empty; the id in the hash should load the saved game,
  // and the cache should fill the body. If the hash id path needs a record
  // load, the page should still find the cache via the saved game's moves.
  const hasGraph = await page.$('.review-graph-svg');
  if (!hasGraph) {
    // The route #/review/<id> loads the saved game; if cache lookup works it
    // should render immediately. If it showed the start button, fail clearly.
    const start = await page.$('[data-act="start"]');
    check('a cached review opens without waiting for the engine', !start && false, start ? 'the start button was shown' : 'no graph and no start button');
    return;
  }
  check('the review shows an evaluation graph', !!hasGraph);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(150);
  await page.screenshot({ path: path.join(SHOTS, 'review-1280.png'), fullPage: true });
  const bar = await page.$('.evalbar');
  check('the review board shows an evaluation bar', !!bar);
  const accW = await text('.review-acc-side .v');
  check('the review shows a numeric accuracy score', /^\d+$/.test(accW), accW);
  const flagged = REVIEW.moves.filter((m) => m.judgment === 'inaccuracy' || m.judgment === 'mistake' || m.judgment === 'blunder' || m.judgment === 'miss');
  check('flagged moves appear in the move list', await page.$$eval('.review-moves .mv.j-miss, .review-moves .mv.j-blunder, .review-moves .mv.j-mistake, .review-moves .mv.j-inaccuracy', (e) => e.length) >= 1);
  // Jump to a flagged move and expect the best-move arrow and the badge.
  const target = flagged[flagged.length - 1];
  await page.click(`.review-moves .mv[data-ply="${target.ply}"]`);
  await sleep(200);
  const chip = await text('.review-chip-name');
  check('the selected move shows its classification', chip === JUDGMENT_LABELS[target.judgment], `${chip} vs ${target.judgment}`);
  const dest = target.uci.slice(2, 4);
  const boardBadge = await page.$eval(`.board .sq[data-square="${dest}"] .review-badge`, (e) => e.getAttribute('data-judgment'));
  check('the classification badge sits on the destination square', boardBadge === target.judgment, `${boardBadge} on ${dest}`);
  const arrows = await page.$$eval('.board-arrows .arrow', (e) => e.length);
  check('a flagged move shows a suggestion or threat arrow', arrows >= 1, `arrows=${arrows}`);
  const suggest = await page.$('.board-arrows .arrow.suggest');
  check('a weaker move shows a green suggestion arrow when a better move exists', !target.suggestionUci || !!suggest);
  check("the last flagged fixture move is 8...h5", target.uci === 'h6h5', target.uci + ' ' + target.san);
  const threat = await page.$eval('.board-arrows .arrow.threat', (e) => ({ from: e.getAttribute('data-from'), to: e.getAttribute('data-to'), knight: e.getAttribute('data-knight'), d: e.getAttribute('d') })).catch(() => null);
  check('8...h5 shows a red refutation arrow from f3 to g5', !!(threat && threat.from === 'f3' && threat.to === 'g5' && target.threatUci === 'f3g5'), JSON.stringify({ threat, threatUci: target.threatUci }));
  const threatLegs = threat && threat.d ? threat.d.trim().split(/\s*L/).length : 0;
  check('the red Nxg5 arrow is L-shaped with a corner point', !!(threat && threat.knight === '1' && threatLegs === 3), JSON.stringify(threat));
  const suggestPath = await page.$eval('.board-arrows .arrow.suggest', (e) => ({ from: e.getAttribute('data-from'), to: e.getAttribute('data-to'), knight: e.getAttribute('data-knight'), d: e.getAttribute('d') })).catch(() => null);
  if (suggestPath) {
    const suggestLegs = suggestPath.d.trim().split(/\s*L/).length;
    check('the green suggestion arrow is straight', suggestPath.knight === '0' && suggestLegs === 2, JSON.stringify(suggestPath));
  }
  await page.screenshot({ path: path.join(SHOTS, 'review-move-1280.png') });
  await page.screenshot({ path: path.join(SHOTS, 'review2-1280.png'), fullPage: true });
  await page.screenshot({ path: path.join(SHOTS, 'knight-arrow-1280.png') });
  const badgeBox = await page.$eval(`.board .sq[data-square="${dest}"] .review-badge`, (e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.max(0, r.x - 24), y: Math.max(0, r.y - 24), w: r.width + 48, h: r.height + 48 };
  });
  await page.screenshot({ path: path.join(SHOTS, 'review2-badge-crop.png'), clip: { x: badgeBox.x, y: badgeBox.y, width: badgeBox.w, height: badgeBox.h } });
  // Flip the board and confirm the badge stays on the same square.
  await page.click('[data-act="flip"]');
  await sleep(150);
  const flippedBadge = await page.$eval(`.board .sq[data-square="${dest}"] .review-badge`, (e) => e.getAttribute('data-judgment'));
  check('the badge stays on the destination square when the board is flipped', flippedBadge === target.judgment);
  const flippedThreat = await page.$eval('.board-arrows .arrow.threat', (e) => ({ from: e.getAttribute('data-from'), to: e.getAttribute('data-to'), knight: e.getAttribute('data-knight'), d: e.getAttribute('d') })).catch(() => null);
  const flippedLegs = flippedThreat && flippedThreat.d ? flippedThreat.d.trim().split(/\s*L/).length : 0;
  check('the red Nxg5 arrow stays L-shaped on a flipped board', !!(flippedThreat && flippedThreat.from === 'f3' && flippedThreat.to === 'g5' && flippedThreat.knight === '1' && flippedLegs === 3 && flippedThreat.d !== (threat && threat.d)), JSON.stringify(flippedThreat));
  await page.click('[data-act="flip"]');
  await sleep(100);
  // Explanation mode on the main board.
  const beforeFen = await page.evaluate(() => window.__chess.reviewFen);
  const displayOf = (sel) => page.$eval(sel, (e) => getComputedStyle(e).display);
  const showLine = await page.$('[data-act="show-line"]');
  const lineDisplay = showLine ? await displayOf('[data-act="show-line"]') : 'none';
  const exitDisplayBefore = await displayOf('[data-act="exit-line"]');
  check('a Show line control is visible for a move with an engine line', !!showLine && lineDisplay !== 'none', lineDisplay);
  check('Exit explanation is not displayed before explanation mode', exitDisplayBefore === 'none', exitDisplayBefore);
  await showLine.click();
  await sleep(200);
  const explaining = await page.evaluate(() => window.__chess.reviewExplain);
  check('Show line enters explanation mode on the review board', !!(explaining && explaining.kind), JSON.stringify(explaining));
  const lineDisplayIn = await displayOf('[data-act="show-line"]');
  const exitDisplayIn = await displayOf('[data-act="exit-line"]');
  check('the Line button is not displayed in explanation mode', lineDisplayIn === 'none', lineDisplayIn);
  check('Exit explanation is displayed in explanation mode', exitDisplayIn !== 'none', exitDisplayIn);
  const fenAtStart = await page.evaluate(() => window.__chess.reviewFen);
  await page.click('[data-act="next"]');
  await sleep(150);
  const fenStepped = await page.evaluate(() => window.__chess.reviewFen);
  const step = await page.evaluate(() => window.__chess.reviewExplain && window.__chess.reviewExplain.step);
  check('the next arrow steps through the engine line and changes the board', fenStepped !== fenAtStart && step === 1, `step=${step} fen ${fenAtStart} -> ${fenStepped}`);
  await page.screenshot({ path: path.join(SHOTS, 'review2-line-1280.png'), fullPage: true });
  await page.click('[data-act="exit-line"]');
  await sleep(150);
  const afterExit = await page.evaluate(() => ({ fen: window.__chess.reviewFen, explain: window.__chess.reviewExplain, ply: window.__chess.reviewPly }));
  check('Exit explanation restores the game position and leaves explanation mode', afterExit.fen === beforeFen && !afterExit.explain, JSON.stringify(afterExit));
  // Escape also exits: re-enter, then press Escape via the page key handler path.
  await page.click('[data-act="show-line"]');
  await sleep(150);
  await page.keyboard.press('Escape');
  await sleep(150);
  const afterEsc = await page.evaluate(() => window.__chess.reviewExplain);
  check('Escape exits explanation mode', !afterEsc);
  // Graph click jumps to a ply.
  await page.click('.review-graph-svg .rg-hit[data-ply="0"]');
  await sleep(150);
  const ply = await page.evaluate(() => window.__chess.reviewPly);
  check('clicking the graph jumps to that position', ply === 0, `ply=${ply}`);
});

// ---- My mistakes with a seeded puzzle ----
await step('My mistakes list and solve', async () => {
  await go('#/puzzles/mistakes');
  const items = await page.$$('.mistake-grid [data-id]');
  check('the list shows the personal puzzle from the review', items.length >= 1);
  const weaknesses = await text('[data-weaknesses]');
  check('Your weaknesses appears once reviews are stored', /Your weaknesses/.test(weaknesses) && /based on/.test(weaknesses), weaknesses.slice(0, 180));
  const sentences = await page.$$eval('[data-weaknesses] p', (ps) => ps.map((p) => p.textContent.trim()));
  check('the weaknesses summary is written in complete sentences', sentences.length >= 1 && sentences.every((s) => /[.?!]$/.test(s) && s.length > 20), sentences.join(' | '));
  const sample = sentences[0] || weaknesses;
  check('the weaknesses intro does not claim zero positions when one is listed', !/0 stored mistake/.test(sample) && /listed for practice/.test(sample), sample.slice(0, 280));
  const cardTitle = await text('.mistake-grid .pz-title');
  check("the mistake card title reads naturally, such as Black's miss, move 8", /Black's miss, move 8/.test(cardTitle), cardTitle);
  const cardText = await text('.mistake-grid li');
  check('the mistake card does not run the status into a confirmation sentence', !/Unsolved The engine/.test(cardText), cardText.slice(0, 220));
  const chips = await page.$$eval('.mistake-grid .mistake-chip', (els) => els.map((e) => e.textContent.trim()));
  check('the mistake card shows a compact Unsolved status chip', chips.includes('Unsolved'), chips.join(','));
  await page.screenshot({ path: path.join(SHOTS, 'mistakes-1280.png') });
  await page.screenshot({ path: path.join(SHOTS, 'review2-weaknesses-1280.png'), fullPage: true });
  const href = await page.$eval('.mistake-grid a.btn', (a) => a.getAttribute('href'));
  await go(href);
  await sleep(300);
  check('the solve view names the side to move', /is to move/.test(await text('.lede')));
  // Play the correct solution move.
  const sol = MISTAKE.solution[0];
  const from = sol.slice(0, 2), to = sol.slice(2, 4);
  await page.click(`.board .sq[data-square="${from}"]`);
  await sleep(80);
  await page.click(`.board .sq[data-square="${to}"]`);
  await sleep(400);
  const status = await text('.puzzle-status');
  check('playing the preferred move solves the personal puzzle', /solved/i.test(status), status);
  await page.screenshot({ path: path.join(SHOTS, 'mistakes-solved-1280.png') });
});

// ---- Analysis eval bar ----
await step('analysis evaluation bar', async () => {
  await go('#/analysis');
  const bar = await page.$('.evalbar');
  check('the analysis board shows an evaluation bar', !!bar);
  const hidden = await page.$eval('.evalbar', (e) => e.classList.contains('hidden'));
  check('the evaluation bar is visible in analysis mode', hidden === false);
  const lede = await text('.lede');
  check('the analysis page says the bar is produced by Stockfish', /Stockfish/.test(lede));
  // Wait briefly for a score; this is optional and does not fail the bar check.
  try {
    await page.waitForFunction(() => {
      const t = document.querySelector('.evalbar-text');
      return t && t.textContent && t.textContent.trim().length > 0;
    }, { timeout: 45000 });
    check('the evaluation bar receives a Stockfish score', true);
  } catch {
    check('the evaluation bar receives a Stockfish score', false, 'no score after 20 s');
  }
  await page.evaluate(() => {
    const panel = document.querySelector('.load-panel');
    if (panel) panel.open = false;
    const bar = document.querySelector('.evalbar');
    if (bar) bar.scrollIntoView({ block: 'center' });
  });
  await sleep(200);
  await page.screenshot({ path: path.join(SHOTS, 'review-analysis-1280.png') });
});

// ---- Mobile screenshots and overflow ----
await step('mobile layout', async () => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  for (const r of ['#/review/' + encodeURIComponent(GAME_RECORD.id), '#/puzzles/mistakes', '#/analysis']) {
    await go(r); await sleep(400);
    const ov = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));
    check(`${r} has no horizontal overflow at 390x844`, ov.scroll <= 1 && ov.body <= 1, JSON.stringify(ov));
  }
  await go('#/review/' + encodeURIComponent(GAME_RECORD.id));
  await sleep(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, 'review-390.png') });
  await page.screenshot({ path: path.join(SHOTS, 'review-390-full.png'), fullPage: true });
  const flaggedPly = REVIEW.moves.filter((m) => m.judgment === 'inaccuracy' || m.judgment === 'mistake' || m.judgment === 'blunder' || m.judgment === 'miss').pop();
  if (flaggedPly) {
    const btn = await page.$(`.review-moves .mv[data-ply="${flaggedPly.ply}"]`);
    if (btn) { await btn.click(); await sleep(200); }
  }
  await page.screenshot({ path: path.join(SHOTS, 'review2-390.png') });
  await page.screenshot({ path: path.join(SHOTS, 'knight-arrow-390.png') });
  await page.screenshot({ path: path.join(SHOTS, 'review2-390-full.png'), fullPage: true });
  const lineBtn = await page.$('[data-act="show-line"]');
  if (lineBtn && (await page.evaluate((b) => getComputedStyle(b).display !== 'none', lineBtn))) {
    await lineBtn.click(); await sleep(200);
    await page.screenshot({ path: path.join(SHOTS, 'review2-line-390.png'), fullPage: true });
    const exit = await page.$('[data-act="exit-line"]');
    if (exit) await exit.click();
  }
  await go('#/puzzles/mistakes');
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, 'mistakes-390.png') });
  await page.screenshot({ path: path.join(SHOTS, 'review2-weaknesses-390.png'), fullPage: true });

  await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await go('#/review/' + encodeURIComponent(GAME_RECORD.id));
  await sleep(300);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('#/review has no horizontal overflow at 375x667', ov <= 1, `overflow=${ov}`);
  await page.screenshot({ path: path.join(SHOTS, 'review-375.png') });
  await go('#/puzzles/mistakes');
  await sleep(200);
  await page.screenshot({ path: path.join(SHOTS, 'mistakes-375.png') });
});

check('no console errors, page errors or failed requests', problems.length === 0, problems.slice(0, 6).join(' | '));
console.log(`\nGUI review tests: ${pass} passed, ${fail} failed`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
