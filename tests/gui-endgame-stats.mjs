// GUI tests for endgame practice and the statistics page (Puppeteer, headless Chrome).
// Run: node tests/gui-endgame-stats.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './gui-static-server.mjs';
import { ENDGAMES, ENDGAME_CATEGORIES } from '../src/data/endgames.js';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER || '/workspace/.ptools/node_modules/puppeteer-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/opt/google/chrome/chrome', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const problems = [];
let pass = 0, fail = 0;
page.on('console', (m) => { if (m.type() === 'error') problems.push(`[console.error] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) problems.push(`[http ${r.status()}] ${r.url()}`); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }
async function step(name, fn) { try { await fn(); } catch (err) { check(name, false, err.message.split('\n')[0]); } }
async function go(route) {
  await page.evaluate((r) => { location.hash = r; }, route);
  const id = route.replace(/^#\/?/, '').split('/')[0] || 'home';
  await page.waitForFunction((id) => window.__chess && window.__chess.ready && window.__chess.page === id, { timeout: 30000 }, id);
  await sleep(400);
}
async function shot(name, width, height) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await sleep(200);
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  check(`screenshot ${name}`, fs.existsSync(file) && fs.statSync(file).size > 1000, file);
}

await page.setViewport({ width: 1280, height: 800 });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });

await step('home links and navigation', async () => {
  await go('#/');
  check('the home page lists an Endgame practice card', await page.$('a[href="#/endgames"]') !== null);
  check('the home page lists a Progress statistics card', await page.$('a[href="#/stats"]') !== null);
  check('the menu has an Endgames item', await page.$('#main-nav-list a[data-route="endgames"]') !== null);
  check('the menu has a Stats item', await page.$('#main-nav-list a[data-route="stats"]') !== null);
});

await step('endgame list', async () => {
  await go('#/endgames');
  const n = await page.$$eval('.eg-card', (e) => e.length);
  check('the list shows every endgame position', n === ENDGAMES.length, `${n} cards`);
  const groups = await page.$$eval('.eg-group', (e) => e.length);
  check('the list is grouped by theme', groups === ENDGAME_CATEGORIES.length, `${groups} groups`);
  const title = await page.$eval('#title-endgames', (e) => e.textContent);
  check('the page title is Endgame practice', title === 'Endgame practice');
});

await shot('endgame-list-1280', 1280, 800);
await shot('endgame-list-390', 390, 844);
await shot('endgame-list-375', 375, 667);

await step('endgame practice board', async () => {
  await page.setViewport({ width: 1280, height: 800 });
  await go('#/endgames/opposition');
  check('the practice view shows a board', await page.$('.board-host .board') !== null);
  check('the practice view has Hint, Show the idea and Retry', await page.$('[data-act="hint"]') !== null && await page.$('[data-act="idea"]') !== null && await page.$('[data-act="retry"]') !== null);
  const movable = await page.evaluate(() => window.__chess.endgame && window.__chess.endgame.session && window.__chess.endgame.session.playerToMove);
  check('White is to move in the opposition position', movable === true);
  await page.click('[data-act="hint"]');
  await sleep(200);
  const hinted = await page.$eval('.board', (el) => el.querySelectorAll('.hint, .sq.hint, [class*="hint"]').length + el.querySelectorAll('.sq.is-hint').length);
  // The board uses hintSquares as a class — look at the implementation.
  const anyHint = await page.evaluate(() => {
    const board = document.querySelector('.board');
    return !!(board && (board.querySelector('.hint') || board.innerHTML.includes('hint') || [...board.querySelectorAll('.sq')].some((s) => /hint/.test(s.className))));
  });
  check('a hint highlights a square or is announced', anyHint || (await page.$eval('.eg-status', (e) => /highlighted|arrow|idea/i.test(e.textContent))));
  await page.click('[data-act="idea"]');
  await sleep(150);
  check('Show the idea reveals the idea text', await page.$eval('.eg-idea', (e) => !e.classList.contains('hidden')));
});

await shot('endgame-play-1280', 1280, 800);
await shot('endgame-play-390', 390, 844);
await shot('endgame-play-375', 375, 667);

await step('stats empty state', async () => {
  await page.setViewport({ width: 1280, height: 800 });
  await go('#/stats');
  const title = await page.$eval('#title-stats', (e) => e.textContent);
  check('the statistics page title is present', title === 'Progress statistics');
  const empty = await page.$$eval('.st-empty, .muted', (els) => els.map((e) => e.textContent).join(' '));
  check('the empty rating state explains that history will be stored', /have been rated yet/.test(empty) && /1500/.test(empty));
  check('the empty opening state mentions the saved games library', /saved games library/.test(empty));
  check('the empty endgame state mentions the Endgames page', /Endgames page/.test(empty));
  const body = await page.$eval('main', (e) => e.textContent);
  check('the puzzle accuracy section includes My mistakes', /My mistakes/.test(body));
});

await shot('stats-empty-1280', 1280, 800);
await shot('stats-empty-390', 390, 844);
await shot('stats-empty-375', 375, 667);

await step('stats filled charts', async () => {
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluate(() => {
    const rating = {
      version: 1, rating: 1284, games: 4, wins: 3, draws: 0, losses: 1, peak: 1284, history: [
        { at: Date.now() - 86400000 * 3, rating: 1236, delta: 36, opponent: 1300, botLevel: 'lvl4', score: 1 },
        { at: Date.now() - 86400000 * 2, rating: 1210, delta: -26, opponent: 1600, botLevel: 'lvl5', score: 0 },
        { at: Date.now() - 86400000, rating: 1250, delta: 40, opponent: 1000, botLevel: 'lvl3', score: 1 },
        { at: Date.now(), rating: 1284, delta: 34, opponent: 1300, botLevel: 'lvl4', score: 1 },
      ],
    };
    const stats = {
      version: 1,
      totals: { wins: 3, draws: 0, losses: 1, games: 4 },
      byLevel: { lvl3: { wins: 1, draws: 0, losses: 0, games: 1 }, lvl4: { wins: 2, draws: 0, losses: 0, games: 2 }, lvl5: { wins: 0, draws: 0, losses: 1, games: 1 } },
      byColor: { w: { wins: 2, draws: 0, losses: 1, games: 3 }, b: { wins: 1, draws: 0, losses: 0, games: 1 } },
    };
    const puzzles = { version: 1, rating: 1280, puzzles: { p1: { solved: true, attempts: 1 }, p2: { solved: true, attempts: 2 }, p3: { solved: false, attempts: 1 } } };
    const online = {
      version: 1,
      bullet: { rating: 1500, deviation: 350, volatility: 0.06, games: 0, wins: 0, draws: 0, losses: 0, peak: 1500, history: [], white: { wins: 0, draws: 0, losses: 0, games: 0 }, black: { wins: 0, draws: 0, losses: 0, games: 0 } },
      blitz: {
        rating: 1284, deviation: 95, volatility: 0.06, games: 4, wins: 3, draws: 0, losses: 1, peak: 1284,
        white: { wins: 2, draws: 0, losses: 1, games: 3 },
        black: { wins: 1, draws: 0, losses: 0, games: 1 },
        history: [
          { at: 1, rating: 1236, delta: 36, score: 1, opponent: 1300, opponentName: 'Ada', color: 'w' },
          { at: 2, rating: 1210, delta: -26, score: 0, opponent: 1600, opponentName: 'Bea', color: 'w' },
          { at: 3, rating: 1250, delta: 40, score: 1, opponent: 1000, opponentName: 'Cara', color: 'b' },
          { at: 4, rating: 1284, delta: 34, score: 1, opponent: 1300, opponentName: 'Ada', color: 'w' },
        ],
      },
      rapid: { rating: 1500, deviation: 350, volatility: 0.06, games: 0, wins: 0, draws: 0, losses: 0, peak: 1500, history: [], white: { wins: 0, draws: 0, losses: 0, games: 0 }, black: { wins: 0, draws: 0, losses: 0, games: 0 } },
    };
    localStorage.setItem('ornate-chess:online-ratings', JSON.stringify(online));
    localStorage.setItem('ornate-chess:player-rating', JSON.stringify(rating));
    localStorage.setItem('ornate-chess:stats', JSON.stringify(stats));
    localStorage.setItem('ornate-chess:puzzle-progress', JSON.stringify(puzzles));
    localStorage.setItem('ornate-chess:gen-stats', JSON.stringify({ solved: 4, attempted: 6, streak: 2, best: 3, byLevel: { easy: { solved: 3, attempted: 3 }, medium: { solved: 1, attempted: 2 }, hard: { solved: 0, attempted: 1 } } }));
    localStorage.setItem('ornate-chess:endgame-progress', JSON.stringify({ version: 1, positions: { 'queen-mate': { completed: true, attempts: 1 }, 'rook-mate': { completed: true, attempts: 2 }, 'lucena': { completed: false, attempts: 1 } } }));
  });
  await go('#/');
  await go('#/stats');
  check('a rating line chart is shown when history exists', await page.$('svg.st-line') !== null);
  check('stacked result bars are shown', (await page.$$('.st-barlist')).length >= 2);
  const body = await page.$eval('#main', (e) => e.textContent);
  check('the rating chart follows the rating over time', /over time/.test(body) && /average rating/.test(body) && await page.$('.st-time .st-x') !== null);
  check('the streak chart has a key', await page.$('svg.st-streak') !== null && await page.$('.st-key') !== null);
  check('the filled page reports the current rating', /1284/.test(body));
  check('the filled page reports endgame completion', /completed 2 of 14/.test(body));
  check('the filled page reports generated puzzle totals', /solved 4 of 6/.test(body));
});

await shot('stats-filled-1280', 1280, 800);
await shot('stats-filled-390', 390, 844);
await shot('stats-filled-375', 375, 667);

const serious = problems.filter((p) => !/favicon/.test(p) && !/service-worker/.test(p) && !/sw\.js/.test(p));
if (serious.length) {
  check('the pages logged no errors', false, serious.slice(0, 6).join(' | '));
} else {
  check('the pages logged no errors', true);
}

await browser.close();
server.close();
console.log(`\nGUI endgame and stats tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
