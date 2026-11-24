// Mobile GUI smoke test. Emulates a phone with touch and checks layout, tap
// and drag moves, undo, a bot game, puzzles, and horizontal overflow.
// Run: node tests/gui-mobile-smoke.mjs
// Screenshots are written to shots/mobile-*.png.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './gui-static-server.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER || '/workspace/.ptools/node_modules/puppeteer-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/opt/ungoogled-chromium/chrome'].find((p) => fs.existsSync(p));

const PHONE = {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.emulate({ viewport: PHONE, userAgent: PHONE_UA });
const problems = [];
const results = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`[console.error] ${m.text()} ${m.location() && m.location().url ? '(' + m.location().url + ')' : ''}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
function ignoreFailedRequest(r) {
  const url = r.url();
  if (url.startsWith('blob:')) return true;
  const err = (r.failure() && r.failure().errorText) || '';
  // Leaving a page that just started Stockfish aborts the in-flight wasm fetch.
  return /stockfish-19-lite-single\.wasm(?:\?|$)/.test(url) && /ERR_ABORTED|NS_BINDING_ABORTED/.test(err);
}
page.on('requestfailed', (r) => { if (!ignoreFailedRequest(r)) problems.push(`[requestfailed] ${r.url()} ${(r.failure() && r.failure().errorText) || ''}`); });
page.on('response', (r) => { if (r.status() >= 400) problems.push(`[http ${r.status()}] ${r.url()}`); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }
async function step(name, fn) { try { await fn(); } catch (err) { check(name, false, err.message.split('\n')[0]); } }
async function ensureBotSetup() {
  if (await page.$('.setup-card') || await page.$('.game-root')) return;
  const bot = await page.$('[data-play="bot"]');
  if (!bot) return;
  await bot.click();
  await page.waitForSelector('.setup-card, .game-root', { timeout: 5000 });
}
async function go(route) {
  await page.evaluate((r) => { location.hash = r; }, route);
  const id = route.replace(/^#\/?/, '').split('/')[0] || 'home';
  await page.waitForFunction((id) => window.__chess && window.__chess.ready && window.__chess.page === id, { timeout: 30000 }, id);
  await sleep(400);
}
async function shot(name, { fullPage = false } = {}) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}
const sq = (n) => `.board .sq[data-square="${n}"]`;
async function squarePoint(name) {
  await page.$eval(sq(name), (e) => e.scrollIntoView({ block: 'center', inline: 'center' }));
  await sleep(80);
  return page.$eval(sq(name), (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  });
}
async function tapSquare(name) {
  const p = await squarePoint(name);
  await page.touchscreen.tap(p.x, p.y);
  await sleep(120);
}
async function touchDrag(from, to) {
  await page.$eval('.board', (e) => e.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await sleep(120);
  const pts = await page.evaluate((from, to) => {
    const box = (n) => {
      const el = document.querySelector(`.board .sq[data-square="${n}"]`);
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    return { a: box(from), b: box(to) };
  }, from, to);
  const { a, b } = pts;
  await page.touchscreen.touchStart(a.x, a.y);
  await sleep(40);
  await page.touchscreen.touchMove(a.x + 16, a.y + 10);
  await sleep(40);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.touchscreen.touchMove(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await sleep(25);
  }
  await page.touchscreen.touchEnd();
  await sleep(250);
}
const ply = () => page.evaluate(() => window.__chess.controller ? window.__chess.controller.game.moves.length : -1);
async function waitBot(n) {
  await page.waitForFunction((n) => { const c = window.__chess.controller; return c && c.game.moves.length >= n && c.game.position.turn === c.playerColor; }, { timeout: 20000 }, n);
  await sleep(350);
}
const pickMove = () => page.evaluate(() => {
  const pos = window.__chess.controller.game.position; const n = (s) => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
  const ms = pos.legalMoves().filter((m) => !m.promotion); const m = ms.find((x) => x.captured) || ms[Math.floor(ms.length / 2)];
  return [n(m.from), n(m.to)];
});
async function overflowInfo() {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const scroll = document.documentElement.scrollWidth - vw;
    const bodyScroll = document.body.scrollWidth - vw;
    return { scroll, bodyScroll, vw, sw: document.documentElement.scrollWidth };
  });
}

const ROUTES = ['home', 'play', 'local', 'puzzles', 'openings', 'endgames', 'stats', 'saved', 'analysis', 'account', 'settings', 'learn'];

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '#/');
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 20000 });
check('app starts on a phone viewport', (await page.evaluate(() => window.__chess.stubs.length)) === 0);

await step('manifest and icons', async () => {
  const href = await page.$eval('link[rel="manifest"]', (e) => e.href);
  const res = await page.evaluate(async (h) => {
    const r = await fetch(h);
    const j = await r.json();
    return { status: r.status, type: r.headers.get('content-type') || '', name: j.name, icons: (j.icons || []).map((i) => i.src) };
  }, href);
  check('the web app manifest loads', res.status === 200 && res.name === 'Ornate Chess', JSON.stringify(res));
  const iconOk = await page.evaluate(async () => {
    const urls = ['assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/apple-touch-icon.png'];
    const out = [];
    for (const u of urls) { const r = await fetch(u); out.push({ u, status: r.status, type: r.headers.get('content-type') }); }
    return out;
  });
  check('PNG icons are served', iconOk.every((i) => i.status === 200 && /png/.test(i.type || '')), JSON.stringify(iconOk));
  const viewport = await page.$eval('meta[name="viewport"]', (e) => e.content);
  check('viewport includes viewport-fit=cover', /viewport-fit=cover/.test(viewport), viewport);
});

await step('menu and overflow on every page', async () => {
  for (const r of ROUTES) {
    await go(r === 'home' ? '#/' : `#/${r}`);
    const ov = await overflowInfo();
    check(`page ${r} has no horizontal overflow at 390x844`, ov.scroll <= 1 && ov.bodyScroll <= 1, JSON.stringify(ov));
    const menu = await page.evaluate(() => {
      const btn = document.querySelector('#nav-toggle');
      const nav = document.querySelector('#site-nav');
      const cs = btn ? getComputedStyle(btn) : { display: 'none' };
      const links = [...document.querySelectorAll('#main-nav-list a')].map((a) => a.textContent.trim());
      const primary = [...document.querySelectorAll('.primary-nav a')].map((a) => a.textContent.trim());
      const sizes = [...document.querySelectorAll('#nav-toggle, .btn, .choice > span')].filter((e) => getComputedStyle(e).display !== 'none').slice(0, 12).map((e) => {
        const b = e.getBoundingClientRect();
        return { h: Math.round(b.height), w: Math.round(b.width), t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24) };
      });
      return { btnDisplay: cs.display, btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0, open: nav && nav.classList.contains('is-open'), links, primary, sizes };
    });
    check(`page ${r} shows a Menu button of at least 44px`, menu.btnDisplay !== 'none' && menu.btnH >= 44, JSON.stringify({ display: menu.btnDisplay, h: menu.btnH }));
    if (r === 'home') {
      check('the bar keeps Home, Play, Two players, Puzzles, Account and Settings', menu.primary.join(', ') === 'Home, Play, Two players, Puzzles, Account, Settings', menu.primary.join(', '));
      check('the menu holds the other pages', menu.links.includes('Openings') && !menu.links.includes('Home') && !menu.links.includes('Play') && !menu.links.includes('Settings'), menu.links.join(', '));
    }
  }
});

await step('named screenshots and tap targets', async () => {
  for (const r of ['home', 'play', 'puzzles', 'saved', 'settings']) {
    await go(r === 'home' ? '#/' : `#/${r}`);
    await sleep(200);
    await shot(`mobile-${r}`, { fullPage: true });
  }
  await go('#/home');
  await page.click('#nav-toggle');
  await sleep(200);
  const open = await page.$eval('#site-nav', (e) => e.classList.contains('is-open'));
  check('the Menu button opens the page list', open);
  const itemH = await page.$eval('#main-nav-list a', (e) => Math.round(e.getBoundingClientRect().height));
  check('menu links are at least 44px tall', itemH >= 44, String(itemH));
  await shot('mobile-home-menu', { fullPage: true });
  await page.click('#main-nav-list a[data-route="openings"]');
  await page.waitForFunction(() => window.__chess && window.__chess.page === 'openings', { timeout: 30000 });
  await sleep(300);
  check('choosing a menu link opens that page', await page.evaluate(() => window.__chess.page) === 'openings');
  check('the menu closes after a link is chosen', await page.$eval('#site-nav', (e) => !e.classList.contains('is-open')));
});

await step('start a bot game, tap, drag and undo', async () => {
  await go('#/play');
  await ensureBotSetup();
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  if (await page.$('dialog[open] .btn.primary')) { await page.click('dialog[open] .btn.primary'); await sleep(300); }
  await page.waitForSelector('.setup-card button[type="submit"]');
  await page.select('#setup-level', 'lvl1');
  const startBtn = await page.$('.setup-card button[type="submit"]');
  const startBox = await startBtn.boundingBox();
  check('the Start button is at least 44px tall', startBox && startBox.height >= 44, String(startBox && startBox.height));
  await startBtn.tap();
  await page.waitForSelector('.board .sq');
  await sleep(300);
  const boardTouch = await page.$eval('.board', (e) => getComputedStyle(e).touchAction);
  check('the board sets touch-action to none', boardTouch === 'none', boardTouch);
  const sqSize = await page.$eval('.board .sq[data-square="e2"]', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right, vw: innerWidth }; });
  check('the board squares are on screen', sqSize.right <= sqSize.vw + 1 && sqSize.w > 20, JSON.stringify(sqSize));

  await tapSquare('e2');
  await tapSquare('e4');
  await waitBot(2);
  check('a tap-to-move plays e4 and the bot replies', (await ply()) === 2);
  check('taps on a touch screen do not create annotations', (await page.$$eval('.board .sq.annot, .board-arrows .annot-arrow', (e) => e.length)) === 0);

  const [f1, t1] = await pickMove();
  const before = await ply();
  await touchDrag(f1, t1);
  const afterDrag = await ply();
  if (afterDrag <= before) {
    const dbg = await page.evaluate(() => {
      const c = window.__chess.controller;
      const sel = c && c.board && c.board.selected;
      const n = (s) => s == null ? null : 'abcdefgh'[s & 7] + ((s >> 3) + 1);
      return { ply: c.game.moves.length, selected: n(sel), turn: c.game.position.turn, last: c.game.sans.slice(-2) };
    });
    check('a touch drag plays a move and the bot replies', false, `${f1}-${t1} did not move: ${JSON.stringify(dbg)}`);
  } else {
    await waitBot(4);
    check('a touch drag plays a move and the bot replies', (await ply()) === 4, `${f1}-${t1}`);
  }

  await page.$eval('[data-act="undo"]', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  const undoBox = await page.$eval('[data-act="undo"]', (e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width }; });
  check('the Undo button is at least 44px tall', undoBox.h >= 44, JSON.stringify(undoBox));
  await (await page.$('[data-act="undo"]')).tap();
  await sleep(300);
  const confirmBtn = await page.$('dialog[open]:not(.gameover-dialog) .btn.primary');
  check('Undo in a rated game asks for confirmation first', !!confirmBtn);
  if (confirmBtn) { await confirmBtn.tap(); await sleep(400); }
  check('undo takes back the player move and the bot reply', (await ply()) === 2);

  const controls = await page.evaluate(() => {
    const need = ['.opening-banner', '.movelist', '.perspective-ctrl', '.controls', '.navbtns', '.player-bar .pb-clock, .player-bar'];
    return need.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, ok: false };
      const r = el.getBoundingClientRect();
      return { sel, ok: true, w: r.width, right: r.right, vw: innerWidth };
    });
  });
  check('opening banner, move list, clocks, controls and perspective are present', controls.every((c) => c.ok && c.right <= c.vw + 2), JSON.stringify(controls));
  const ov = await overflowInfo();
  check('the play view has no horizontal overflow after moves', ov.scroll <= 1, JSON.stringify(ov));
  await page.$eval('.opening-banner', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  await shot('mobile-play-game', { fullPage: true });
});

await step('open a puzzle', async () => {
  await go('#/puzzles');
  await page.waitForSelector('.puzzle-card');
  const ovList = await overflowInfo();
  check('the puzzle list has no horizontal overflow', ovList.scroll <= 1, JSON.stringify(ovList));
  await (await page.$('.puzzle-card')).tap();
  await page.waitForFunction(() => window.__chess.page === 'puzzles' && document.querySelector('.board .sq'), { timeout: 30000 });
  await sleep(300);
  check('opening a puzzle shows a board', !!(await page.$('.board .sq')));
  const ovPz = await overflowInfo();
  check('the puzzle view has no horizontal overflow', ovPz.scroll <= 1, JSON.stringify(ovPz));
  await shot('mobile-puzzle-open', { fullPage: true });
});

await step('shared audio context after taps', async () => {
  const st = await page.evaluate(async () => {
    const m = await import(new URL('src/ui/sound.js', location.href).href);
    const before = m.audioState();
    let threw = null;
    try { m.play('move'); m.play('capture'); m.play('check'); } catch (e) { threw = e.message; }
    await new Promise((r) => setTimeout(r, 150));
    return { before, after: m.audioState(), threw };
  });
  check('taps on the board created the shared audio context', st.before.hasContext, JSON.stringify(st.before));
  check('the shared audio context is running after a tap', st.after.state === 'running', JSON.stringify(st.after));
  check('playing several sounds in a row does not throw', !st.threw, st.threw || '');
});


await step('online ratings at 390px', async () => {
  await page.evaluate(() => {
    localStorage.removeItem('ornate-chess:player-rating');
    localStorage.removeItem('ornate-chess:online-ratings');
    localStorage.removeItem('ornate-chess:autosave');
  });
  await go('#/');
  await page.$eval('.rating-panel', (e) => e.scrollIntoView({ block: 'start' })); await sleep(150);
  const fit0 = await page.$eval('.rating-panel', (e) => {
    const r = e.getBoundingClientRect();
    return { right: r.right, vw: innerWidth, figs: [...e.querySelectorAll('.rating-figure')].map((n) => n.textContent.trim()) };
  });
  check('the rating panel fits at 390px and each pace starts at 1500?', fit0.right <= fit0.vw + 1 && fit0.figs.join(',') === '1500?,1500?,1500?', JSON.stringify(fit0));
  const ov0 = await overflowInfo();
  check('the Home page with three ratings has no horizontal overflow at 390px', ov0.scroll <= 1 && ov0.bodyScroll <= 1, JSON.stringify(ov0));
  await shot('rating-home-390');

  await go('#/play');
  await ensureBotSetup();
  await page.waitForSelector('.setup-card');
  check('the bot setup has no Rated toggle at 390px', !(await page.$('.setup-card input[name="rated"]')));
  check('the bot setup says the game is not rated', /not rated/.test(await page.$eval('.setup-card', (e) => e.textContent)));
  const setup = await page.$eval('.setup-card', (e) => { const r = e.getBoundingClientRect(); return { right: r.right, vw: innerWidth }; });
  check('the bot setup fits at 390px', setup.right <= setup.vw + 1, JSON.stringify(setup));
  await shot('rating-setup-390');

  await go('#/settings');
  const summary = await page.$eval('.rating-summary', (e) => e.textContent);
  check('Settings lists the three ratings at 390px', /Bullet is 1500\?/.test(summary) && /Blitz is 1500\?/.test(summary) && /Rapid is 1500\?/.test(summary), summary);
  check('Settings has no button that resets a rating', !(await page.$('[data-act="reset-rating"]')));
  const ov = await overflowInfo();
  check('Settings has no horizontal overflow at 390px', ov.scroll <= 1 && ov.bodyScroll <= 1, JSON.stringify(ov));
});

await step('landscape 844x390 overflow', async () => {
  await page.setViewport(LANDSCAPE);
  await sleep(250);
  for (const r of ['home', 'play', 'puzzles', 'settings']) {
    await go(r === 'home' ? '#/' : `#/${r}`);
    const ov = await overflowInfo();
    check(`page ${r} has no horizontal overflow in landscape`, ov.scroll <= 1 && ov.bodyScroll <= 1, JSON.stringify(ov));
  }
  await go('#/');
  await page.$eval('.rating-panel', (e) => e.scrollIntoView({ block: 'start' })); await sleep(150);
  const rp = await page.$eval('.rating-panel', (e) => { const r = e.getBoundingClientRect(); return { right: r.right, vw: innerWidth }; });
  check('the rating panel fits in landscape', rp.right <= rp.vw + 1, JSON.stringify(rp));
  await shot('rating-home-landscape');
  await go('#/play');
  if (await page.$('.board .sq')) {
    await shot('mobile-play-landscape', { fullPage: true });
    const layout = await page.evaluate(() => {
      const g = document.querySelector('.game-layout');
      return { cols: g ? getComputedStyle(g).gridTemplateColumns : null };
    });
    check('landscape play uses a two-column game layout', layout.cols && layout.cols.split(' ').length >= 2 && !/^minmax\(0,\s*1fr\)$/.test(layout.cols.trim()), layout.cols);
  }
  await page.emulate({ viewport: PHONE, userAgent: PHONE_UA });
  await sleep(200);
});

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (problems.length) { console.log(`Console or network problems (${problems.length}):`); problems.forEach((p) => console.log('  ' + p)); }
else console.log('No console errors, page errors or failed requests.');
process.exit(failed.length || problems.length ? 1 : 0);
