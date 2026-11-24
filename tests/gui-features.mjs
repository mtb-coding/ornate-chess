// GUI test for the opening library and generated puzzles (Puppeteer, headless Chrome).
// Run: node tests/gui-features.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './gui-static-server.mjs';
import { Position, START_FEN } from '../src/engine.js';
import { LIBRARY } from '../src/data/opening-library.js';

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
  const id = route.replace(/^#\/?/, '').split('/')[0] || 'home';
  await page.waitForFunction((id) => window.__chess && window.__chess.ready && window.__chess.page === id, { timeout: 30000 }, id);
  await sleep(400);
}
const sq = (n) => `.board .sq[data-square="${n}"]`;
async function clickMove(from, to) { await page.click(sq(from)); await sleep(80); await page.click(sq(to)); }
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
function sanToSquares(sans, k) {
  let pos = Position.fromFen(START_FEN);
  for (let i = 0; i < k; i++) pos = pos.makeMove(pos.parseSan(sans[i]));
  const u = pos.moveToUci(pos.parseSan(sans[k]));
  return [u.slice(0, 2), u.slice(2, 4), pos];
}

await page.setViewport({ width: 1280, height: 800 });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });

// ---- Opening library ----
await step('opening library browse', async () => {
  await go('#/openings');
  const n = await page.$$eval('.op-card', (e) => e.length);
  check('the library lists every opening', n === LIBRARY.length, `${n} cards`);
  check('the menu has an Openings item', await page.$('#main-nav-list a[data-route="openings"]') !== null);
  await page.type('#op-q', 'najdorf'); await sleep(250);
  const names = await page.$$eval('.op-card .op-family', (e) => e.map((x) => x.textContent));
  check('searching for "najdorf" finds Sicilian lines only', names.length >= 1 && names.every((x) => /Sicilian/.test(x)), names.join(', '));
  const clear = () => page.$eval('#op-q', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await clear();
  await page.type('#op-q', 'C42'); await sleep(250);
  const ecos = await page.$$eval('.op-card .ob-eco', (e) => e.map((x) => x.textContent));
  check('searching for an ECO code finds that code', ecos.length >= 1 && ecos.every((x) => x === 'C42'), ecos.join(', '));
  await clear();
  await page.select('#op-cat', 'flank'); await sleep(250);
  const cats = await page.$$eval('.op-group', (e) => e.length);
  check('the category filter shows one group', cats === 1);
  await page.select('#op-cat', ''); await sleep(150);
});

const entry = LIBRARY.find((o) => o.side === 'w' && o.moves.startsWith('e4 e5') && o.moves.split(' ').length >= 5) || LIBRARY[0];
const sans = entry.moves.split(' ');
await step('opening viewer', async () => {
  await go(`#/openings/${encodeURIComponent(entry.id)}`);
  const title = await text('.page-title');
  check('the viewer shows the opening name', title.includes(entry.name.split(':')[0]), title);
  check('the viewer shows the ECO code', (await text('.lede')).startsWith(entry.eco));
  const plyNow = () => page.evaluate(() => window.__chess.opening.state.ply);
  check('the viewer starts at the final position', await plyNow() === sans.length);
  await page.click('[data-nav="first"]'); await sleep(200);
  check('Start goes to the initial position', await plyNow() === 0);
  await page.click('[data-nav="next"]'); await page.click('[data-nav="next"]'); await sleep(250);
  check('Forward steps through the line', await plyNow() === 2);
  await page.click('[data-nav="prev"]'); await sleep(200);
  check('Back steps backwards', await plyNow() === 1);
  await page.keyboard.press('End'); await sleep(200);
  check('the End key goes to the final position', await plyNow() === sans.length);
  await page.keyboard.press('ArrowLeft'); await sleep(200);
  check('the left arrow key steps back', await plyNow() === sans.length - 1);
  const p = await page.$('.op-movelist .mv');
  if (p) { await p.click(); await sleep(200); check('clicking a move in the list jumps to it', await plyNow() === 1); }
  await page.screenshot({ path: path.join(SHOTS, 'feat-opening-view-1280.png') });
});

await step('opening practice', async () => {
  await page.click('input[name="op-side"][value="w"]');
  await page.click('[data-pr="start"]'); await sleep(300);
  check('practice starts from the initial position', await page.evaluate(() => window.__chess.opening.state.mode === 'practice' && window.__chess.opening.state.ply === 0));
  const [f0, t0] = sanToSquares(sans, 0);
  const wrong = f0 === 'e2' ? ['d2', 'd4'] : ['e2', 'e4'];
  await clickMove(wrong[0], wrong[1]); await sleep(1200);
  check('a wrong move is taken back', await page.evaluate(() => window.__chess.opening.state.ply) === 0);
  check('a wrong move is explained', /not the book move|not the move|wrong|book move/i.test(await text('.op-status')), await text('.op-status'));
  for (let k = 0; k < sans.length; k += 2) {
    const [f, t] = sanToSquares(sans, k);
    await page.waitForFunction((k) => window.__chess.opening.state.ply === k && !window.__chess.opening.state.busy, { timeout: 20000 }, k);
    await clickMove(f, t);
    await sleep(150);
  }
  await page.waitForFunction((n) => window.__chess.opening.state.ply === n, { timeout: 20000 }, sans.length);
  await sleep(700);
  check('the line is completed in practice', true);
  check('the continuation offer appears', await page.$eval('.op-continue', (e) => !e.hidden));
  await page.screenshot({ path: path.join(SHOTS, 'feat-opening-practice-1280.png') });
  void t0;
  await page.click('[data-pr="bot"]');
  await page.waitForFunction(() => window.__chess.page === 'play' && window.__chess.controller, { timeout: 30000 });
  await sleep(800);
  const n = await page.evaluate(() => window.__chess.controller.game.moves.length);
  check('the game against the bot starts from the end of the line', n >= sans.length, `${n} moves`);
  const name = await page.evaluate(() => document.body.textContent.includes(window.__chess.opening.entry.name.split(':')[0]));
  check('the game view shows the name of the opening', name);
});

// ---- Generated puzzles ----
async function waitPuzzle(level) {
  await page.waitForFunction((lv) => window.__chess.genPuzzle && window.__chess.genPuzzle.session && (!lv || window.__chess.genPuzzle.puzzle.level === lv), { timeout: 90000 }, level || null);
  await sleep(500);
  return page.evaluate(() => { const g = window.__chess.genPuzzle; return { p: g.puzzle, ply: g.session.ply }; });
}
await step('generated puzzles', async () => {
  await go('#/puzzles');
  check('the puzzle page shows the mode tabs', await page.$('.mode-tabs') !== null);
  await go('#/puzzles/generated?level=easy');
  const t0 = Date.now();
  let { p } = await waitPuzzle();
  check('an easy puzzle appears', p && p.level === 'easy', `${Date.now() - t0} ms, ${p && p.code}`);
  // Find a puzzle without promotion to keep clicking simple.
  for (let i = 0; i < 5 && p.solution.some((u) => u.length > 4); i++) { await page.click('[data-act="next"]'); await sleep(300); ({ p } = await waitPuzzle()); }
  const before = await page.evaluate(() => window.__chess.genPuzzle.session.position.toFen());
  const wrong = await page.evaluate(() => {
    const s = window.__chess.genPuzzle.session; const p = s.puzzle;
    const alts = (p.alternatives && p.alternatives[0]) || [];
    const m = s.position.legalMoves().find((m) => { const u = s.position.moveToUci(m); return u !== p.solution[0] && !alts.includes(u) && !u[4]; });
    return s.position.moveToUci(m);
  });
  await clickMove(wrong.slice(0, 2), wrong.slice(2, 4)); await sleep(1300);
  check('a wrong move is rejected and the position is restored', await page.evaluate(() => window.__chess.genPuzzle.session.position.toFen()) === before);
  check('the status explains the wrong move', /not|wrong|try/i.test(await text('.puzzle-status')), await text('.puzzle-status'));
  for (let k = 0; k < p.solution.length; k += 2) {
    await page.waitForFunction((k) => window.__chess.genPuzzle.session.ply === k, { timeout: 20000 }, k);
    await sleep(250);
    const u = p.solution[k];
    await clickMove(u.slice(0, 2), u.slice(2, 4));
  }
  await page.waitForFunction(() => window.__chess.genPuzzle.session.complete, { timeout: 20000 });
  await sleep(600);
  const label = await text('.gen-theme-label');
  check('the theme label is shown after solving', label.length > 2 && !(await page.$eval('.gen-result', (e) => e.classList.contains('hidden'))), label);
  check('the theme label uses the correct article for the level', /it is an easy puzzle/.test(label), label);
  const expl = await text('.gen-expl');
  check('the explanation is written in sentences', /^[A-Z].*\.$/.test(expl), expl.slice(0, 120));
  check('the solved count increases', await text('[data-stat="solved"]') === '1');
  check('a solve after a wrong move does not count towards the streak', await text('[data-stat="streak"]') === '0');
  await page.screenshot({ path: path.join(SHOTS, 'feat-gen-solved-1280.png') });

  await page.click('[data-act="next"]');
  ({ p } = await waitPuzzle());
  for (let k = 0; k < p.solution.length; k += 2) {
    await page.waitForFunction((k) => window.__chess.genPuzzle.session.ply === k, { timeout: 20000 }, k);
    await sleep(250);
    const u = p.solution[k];
    if (u.length > 4) break;
    await clickMove(u.slice(0, 2), u.slice(2, 4));
  }
  if (!p.solution.some((u) => u.length > 4)) {
    await page.waitForFunction(() => window.__chess.genPuzzle.session.complete, { timeout: 20000 }); await sleep(500);
    check('a clean solve increases the streak', await text('[data-stat="streak"]') === '1');
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ornate-chess:gen-stats') || '{}'));
  check('the statistics are stored in localStorage', stored.solved >= 1, JSON.stringify(stored).slice(0, 120));

  // Moving on after a wrong move ends the streak.
  if (await text('[data-stat="streak"]') === '1') {
    await page.click('[data-act="next"]');
    ({ p } = await waitPuzzle());
    const bad = await page.evaluate(() => {
      const s = window.__chess.genPuzzle.session; const p = s.puzzle;
      const alts = (p.alternatives && p.alternatives[0]) || [];
      const m = s.position.legalMoves().find((m) => { const u = s.position.moveToUci(m); return u !== p.solution[0] && !alts.includes(u) && !u[4]; });
      return s.position.moveToUci(m);
    });
    await clickMove(bad.slice(0, 2), bad.slice(2, 4)); await sleep(1300);
    check('a streak of 1 is still shown after a wrong move', await text('[data-stat="streak"]') === '1');
    await page.click('[data-act="next"]'); await sleep(300);
    check('moving on after a wrong move ends the streak', await text('[data-stat="streak"]') === '0');
    check('the best streak is kept when the streak ends', await text('[data-stat="best"]') === '1');
    ({ p } = await waitPuzzle());
  }

  await page.click('[data-act="next"]');
  ({ p } = await waitPuzzle());
  await page.click('[data-act="hint"]'); await sleep(250);
  check('the hint highlights a square', await page.$$eval('.board .sq.hint, .board .sq.hint-from, .board .sq[class*="hint"]', (e) => e.length) >= 1);
  await page.click('[data-act="solution"]');
  await page.waitForFunction(() => window.__chess.genPuzzle.session.complete, { timeout: 30000 }); await sleep(500);
  check('Show solution plays the line and resets the streak', await text('[data-stat="streak"]') === '0');

  // Seeded replay through the code form.
  const code = p.code;
  await go('#/puzzles/generated?code=' + encodeURIComponent(code));
  const again = await waitPuzzle();
  check('a puzzle code rebuilds the same puzzle', again.p.code === code && again.p.fen === p.fen, code);
  check('a rebuilt generated puzzle is marked as verified', again.p.verified === true);

  // A known non-unique code from the earlier build must load as unverified.
  await go('#/puzzles/generated?code=e16.g');
  const bad = await waitPuzzle();
  check('a known non-unique code still loads a position', bad.p && bad.p.code === 'e16.g', bad.p && bad.p.code);
  check('the rebuilt non-unique puzzle is marked unverified', bad.p && bad.p.verified === false);
  check('the unverified notice is shown', await page.$eval('.gen-unverified', (e) => !e.classList.contains('hidden')));
  await page.click('[data-act="solution"]');
  await page.waitForFunction(() => window.__chess.genPuzzle.session.complete, { timeout: 30000 }); await sleep(500);
  const badExpl = await text('.gen-expl');
  check('an unverified puzzle does not claim a unique engine margin', !/estimates that every other first move|rates every other first move at least two pawns/.test(badExpl), badExpl.slice(0, 180));

  check('an elapsed-time element is on the page', await page.$('.gen-elapsed') !== null);

  await page.select('#gen-level', 'medium');
  const t1 = Date.now();
  const med = await waitPuzzle('medium');
  check('a medium puzzle appears after changing the level', med.p.level === 'medium', `${Date.now() - t1} ms`);
});

await step('generated puzzle engine and workers', async () => {
  check('the page runs the generator pool', await page.evaluate(() => !!window.__chess.generator));
  const running = await page.evaluate(() => window.__chess.generator.workers.length);
  check('background workers are running on the generated puzzle page', running >= 1, String(running));
  await go('#/openings'); await sleep(500);
  const after = await page.evaluate(() => ({ workers: window.__chess.generator.workers.length, running: window.__chess.generator.running }));
  check('leaving the generated puzzle page stops the workers', after.workers === 0 && after.running === false, JSON.stringify(after));
  await page.evaluate(() => localStorage.removeItem('ornate-chess:gen-pool-v2'));
  await go('#/puzzles/generated?level=hard');
  await sleep(500);
  check('the generator starts again when the page is opened again', await page.evaluate(() => window.__chess.generator.workers.length) >= 1);
  await waitPuzzle();

  // The outline for captured black pieces is applied by the loaded stylesheet.
  const filter = await page.evaluate(() => {
    const host = document.createElement('div'); host.className = 'cap cap-b'; host.innerHTML = '<svg viewBox="0 0 10 10" width="20" height="20"></svg>';
    document.body.appendChild(host);
    const f = getComputedStyle(host.querySelector('svg')).filter; host.remove(); return f;
  });
  check('captured black pieces have an outline filter', /drop-shadow/.test(filter), filter);

  // A damaged pool entry must not break the page.
  await page.evaluate(() => localStorage.setItem('ornate-chess:gen-pool-v2', JSON.stringify({ easy: [{ fen: 'abc', solution: ['e2e4'], level: 'easy', code: 'e1.2' }] })));
  await go('#/puzzles/generated?level=easy');
  await waitPuzzle();
  check('a damaged stored puzzle is ignored', await page.evaluate(() => window.__chess.genPuzzle.puzzle.fen !== 'abc'));
});

await step('generated puzzles without the engine', async () => {
  // A second server answers 404 for the engine files, as if they were missing from the install.
  const noEngine = await startServer(0, { block: '/vendor/stockfish/' });
  const bad = await browser.newPage();
  await bad.setViewport({ width: 1280, height: 800 });
  await bad.goto(`http://127.0.0.1:${noEngine.address().port}/index.html#/puzzles/generated?level=hard`, { waitUntil: 'load' });
  await bad.waitForFunction(() => /could not create a puzzle/i.test(document.querySelector('.puzzle-status') ? document.querySelector('.puzzle-status').textContent : ''), { timeout: 60000 }).then(
    () => check('a missing engine produces an explanation instead of an endless wait', true),
    () => check('a missing engine produces an explanation instead of an endless wait', false, 'no message after 60 s'));
  await bad.close(); noEngine.close();
});

// ---- Mobile layout ----
await step('mobile layout', async () => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  for (const r of ['#/openings', `#/openings/${encodeURIComponent(entry.id)}`, '#/puzzles/generated', '#/puzzles']) {
    await go(r); await sleep(400);
    const ov = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));
    check(`${r} has no horizontal overflow at 390x844`, ov.scroll <= 1 && ov.body <= 1, JSON.stringify(ov));
  }
  await go(`#/openings/${encodeURIComponent(entry.id)}`);
  const rows = await page.$$eval('.nav-controls .btn', (b) => new Set(b.map((x) => Math.round(x.getBoundingClientRect().top))).size);
  check('the four navigation buttons fit on one row on a phone', rows === 1);
  await page.screenshot({ path: path.join(SHOTS, 'feat-opening-view-390.png') });
  await go('#/puzzles/generated');
  await waitPuzzle();
  await page.screenshot({ path: path.join(SHOTS, 'feat-gen-390.png') });
});

check('no console errors, page errors or failed requests', problems.length === 0, problems.slice(0, 5).join(' | '));
console.log(`\nGUI feature tests: ${pass} passed, ${fail} failed`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
