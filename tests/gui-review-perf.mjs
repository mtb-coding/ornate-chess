// Mobile performance check for Game review stepping (Puppeteer, headless Chrome).
// Emulates a 390x844 phone (DPR 3, touch) with CPU throttling and measures
// tap-to-next-paint latency for each review interaction on a real 80-ply review.
// Run: node tests/gui-review-perf.mjs [--throttle=6] [--json=out.json] [--no-assert]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './gui-static-server.mjs';
import { buildReview, reviewFingerprint, REVIEW_DEPTH } from '../src/review.js';
import { createReviewStore } from '../src/review-storage.js';
import { MemoryStorage } from '../src/storage.js';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER || '/workspace/.ptools/node_modules/puppeteer-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const THROTTLE = +arg('throttle', 6);
const JSON_OUT = arg('json', '');
const ASSERT = !process.argv.includes('--no-assert');
const SHOT = arg('shot', '');
const TRACE = arg('trace', '');
const EXTRA_CSS = arg('css', ''); // experiments only
const ONLY = arg('only', '');
const CHROME = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/perf-review-evals.json'), 'utf8'));
const REVIEW = buildReview({ startFen: FX.startFen, uci: FX.uci, mode: 'local', depth: REVIEW_DEPTH, name: 'Perf game', evals: FX.evals });
REVIEW.analyzedAt = 1700000000000;
const FP = reviewFingerprint(FX.startFen, FX.uci, REVIEW_DEPTH);
const mem = new MemoryStorage();
createReviewStore({ backend: mem }).saveReview(REVIEW);
const SEED = {
  index: mem.getItem('ornate-chess:reviews-index'),
  key: `ornate-chess:review:${FP}`,
  review: mem.getItem(`ornate-chess:review:${FP}`),
  mistakes: mem.getItem('ornate-chess:mistake-puzzles'),
  games: JSON.stringify([{ id: 'perf-game', name: 'Perf game', savedAt: 1700000000000, mode: 'local',
    game: { version: 1, startFen: FX.startFen, uci: FX.uci, resultInfo: { result: '*', reason: '' } } }]),
};

const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
await page.evaluateOnNewDocument(() => {
  window.__perf = { long: [], frames: [] };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push({ t: e.startTime, d: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* unsupported */ }
});
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });
await page.evaluate((s) => {
  localStorage.clear();
  localStorage.setItem('ornate-chess:reviews-index', s.index);
  localStorage.setItem(s.key, s.review);
  localStorage.setItem('ornate-chess:mistake-puzzles', s.mistakes);
  localStorage.setItem('ornate-chess:games', s.games);
}, SEED);
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
if (EXTRA_CSS) await page.evaluate((c) => { const st = document.createElement('style'); st.textContent = c; document.head.appendChild(st); }, EXTRA_CSS);

// Page load: navigate to the review route and wait for the board to show the final position.
const tLoad0 = Date.now();
await page.evaluate(() => { location.hash = '#/review/perf-game'; });
await page.waitForFunction(() => window.__chess.page === 'review' && document.querySelector('.page-review .board .piece') && window.__chess.reviewPly > 0, { timeout: 60000 });
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
const loadMs = Date.now() - tLoad0;
await sleep(500);

// In-page latency probe: from the input event's timestamp to the first frame
// after the handler ran (rAF, then a task after it, which is after paint).
await page.evaluate(() => {
  window.__lat = [];
  const mark = (e) => {
    const t0 = e.timeStamp;
    requestAnimationFrame(() => setTimeout(() => { window.__lat.push(performance.now() - t0); }, 0));
  };
  document.addEventListener('pointerdown', mark, true);
  document.addEventListener('keydown', mark, true);
  window.__frameLoop = () => {
    let last = performance.now();
    const f = (t) => { window.__perf.frames.push(t - last); last = t; if (window.__frameOn) requestAnimationFrame(f); };
    window.__frameOn = true; requestAnimationFrame(f);
  };
});

async function settle() { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))); }
async function scenario(name, fn) {
  if (ONLY && !name.startsWith(ONLY)) return;
  await page.evaluate(() => { window.__lat = []; window.__perf.long = []; window.__perf.frames = []; window.__frameLoop(); });
  const m0 = await metrics();
  const t0 = Date.now();
  await fn();
  await settle(); await sleep(150);
  const m1 = await metrics();
  const r = await page.evaluate(() => { window.__frameOn = false; return { lat: window.__lat.slice(), long: window.__perf.long.slice(), frames: window.__perf.frames.slice() }; });
  const lat = r.lat.sort((a, b) => a - b);
  const q = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : 0;
  const frames = r.frames.slice(1);
  const out = { name, n: lat.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(lat.at(-1) || 0).toFixed(1),
    longTasks: r.long.length, longTotal: +r.long.reduce((s, e) => s + e.d, 0).toFixed(0),
    framesOver50: frames.filter((f) => f > 50).length, wallMs: Date.now() - t0,
    // Main-thread work per interaction (script, style, layout and paint), from Chrome's own counters.
    taskPerStep: lat.length ? +((m1.TaskDuration - m0.TaskDuration) * 1000 / lat.length).toFixed(1) : 0,
    layoutPerStep: lat.length ? +(((m1.LayoutDuration - m0.LayoutDuration) + (m1.RecalcStyleDuration - m0.RecalcStyleDuration)) * 1000 / lat.length).toFixed(1) : 0,
    layouts: m1.LayoutCount - m0.LayoutCount };
  results.push(out);
  console.log(`${name.padEnd(22)} n=${String(out.n).padStart(3)} p50=${String(out.p50).padStart(6)}ms p95=${String(out.p95).padStart(6)}ms max=${String(out.max).padStart(6)}ms long=${out.longTasks}/${out.longTotal}ms jank>50=${out.framesOver50} main/step=${out.taskPerStep}ms style+layout/step=${out.layoutPerStep}ms layouts=${out.layouts}`);
}
const results = [];
const tap = async (sel) => { await page.tap(sel); await settle(); await sleep(120); };

await scenario('tap first+next x40', async () => {
  await tap('[data-act="first"]');
  if (TRACE) await page.tracing.start({ path: TRACE, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'disabled-by-default-v8.cpu_profiler', 'blink', 'cc', 'viz'] });
  for (let i = 0; i < 40; i++) await tap('[data-act="next"]');
  if (TRACE) await page.tracing.stop();
});
await scenario('tap prev x20', async () => { for (let i = 0; i < 20; i++) await tap('[data-act="prev"]'); });
await scenario('keyboard right x30', async () => {
  await page.focus('[data-act="next"]');
  for (let i = 0; i < 30; i++) { await page.keyboard.press('ArrowRight'); await settle(); await sleep(120); }
});
await scenario('tap move list x20', async () => {
  for (let i = 0; i < 20; i++) {
    const ply = 1 + ((i * 37) % 80);
    await page.evaluate((p) => document.querySelector(`.review-moves .mv[data-ply="${p}"]`).scrollIntoView({ block: 'center' }), ply);
    await tap(`.review-moves .mv[data-ply="${ply}"]`);
  }
});
await scenario('tap graph x10', async () => {
  await page.evaluate(() => document.querySelector('.review-graph-wrap').scrollIntoView({ block: 'center' }));
  for (let i = 0; i < 10; i++) {
    const box = await (await page.$('.review-graph-svg')).boundingBox();
    await page.touchscreen.tap(box.x + box.width * (0.1 + 0.08 * i), box.y + box.height / 2); await settle(); await sleep(120);
  }
});
await scenario('line open+step x8+exit', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  for (let k = 0; k < 3; k++) {
    await tap('[data-act="prev"]');
    const has = await page.$eval('[data-show-line]', (b) => !b.hidden);
    if (!has) continue;
    await tap('[data-act="show-line"]');
    for (let i = 0; i < 8; i++) await tap('[data-act="next"]');
    await tap('[data-act="exit-line"]');
  }
});
await scenario('rapid next x20 (60ms)', async () => {
  await tap('[data-act="first"]');
  for (let i = 0; i < 20; i++) { await page.tap('[data-act="next"]'); await sleep(60); }
});
const heap = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null));
const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
console.log(`page load (route to board) ${loadMs} ms, heap ${heap} MB, DOM elements ${domNodes}, CPU throttle ${THROTTLE}x`);
if (SHOT) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.tap('[data-act="last"]'); await sleep(400);
  await page.screenshot({ path: SHOT, fullPage: true });
  console.log('screenshot', SHOT);
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ throttle: THROTTLE, loadMs, heap, domNodes, results }, null, 1));
await browser.close(); server.close();
let fail = 0;
if (problems.length) { console.log('FAIL page errors:', problems.join(' | ')); fail++; }
if (ASSERT) {
  // Budgets at the default 6x throttling. Layout counts are deterministic:
  // before the fix each step forced about 18 layouts (a height transition on
  // the eval bar), after it one. Latency budgets are loose because headless
  // timing is noisy.
  const step = results.find((r) => r.name.startsWith('tap first'));
  if (step) {
    const perStep = step.layouts / step.n;
    const okL = perStep <= 3;
    console.log(`${okL ? 'PASS' : 'FAIL'} a review step causes at most 3 layouts (${perStep.toFixed(1)})`);
    if (!okL) fail++;
    const okP = step.p95 < 150;
    console.log(`${okP ? 'PASS' : 'FAIL'} step tap p95 under 150 ms at ${THROTTLE}x (${step.p95} ms)`);
    if (!okP) fail++;
  }
  const line = results.find((r) => r.name.startsWith('line'));
  if (line) {
    const perStep = line.layouts / line.n;
    const ok = perStep <= 3;
    console.log(`${ok ? 'PASS' : 'FAIL'} an engine-line step causes at most 3 layouts (${perStep.toFixed(1)})`);
    if (!ok) fail++;
  }
}
process.exit(fail ? 1 : 0);
