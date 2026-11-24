// GUI smoke test (Puppeteer, headless Chrome). Run: node tests/gui-smoke.mjs
// Serves the folder, visits every page, plays against the bot at a low level,
// saves and loads a game, solves puzzles, and writes screenshots to shots/.
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

const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
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
async function shot(name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); }
const sq = (n) => `.board .sq[data-square="${n}"]`;
async function clickMove(from, to) { await page.click(sq(from)); await sleep(80); await page.click(sq(to)); }
async function dragMove(from, to) {
  const a = await (await page.$(sq(from))).boundingBox(); const b = await (await page.$(sq(to))).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
}
// A bot game is unrated, so Undo and Hint do not ask for confirmation.
async function acceptConfirm(expect) {
  const d = await page.waitForSelector('dialog[open]:not(.gameover-dialog)', { timeout: 1500 }).catch(() => null);
  if (!d) { if (expect) check('a confirmation dialog appears before the game becomes unrated', false); return false; }
  const text = await page.$eval('dialog[open]', (e) => e.textContent);
  if (expect) check('the confirmation explains that the game becomes unrated', /makes it unrated/.test(text), text.replace(/\s+/g, ' ').slice(0, 160));
  await page.click('dialog[open] .btn.primary'); await sleep(200);
  return true;
}
const ply = () => page.evaluate(() => window.__chess.controller ? window.__chess.controller.game.moves.length : -1);
async function waitBot(n) {
  await page.waitForFunction((n) => { const c = window.__chess.controller; return c && c.game.moves.length >= n && c.game.position.turn === c.playerColor; }, { timeout: 60000 }, n);
  await sleep(350);
}
// A legal non-promotion move for the side to move, chosen in the page from engine data.
const pickMove = () => page.evaluate(() => {
  const pos = window.__chess.controller.game.position; const n = (s) => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
  const ms = pos.legalMoves().filter((m) => !m.promotion); const m = ms.find((x) => x.captured) || ms[Math.floor(ms.length / 2)];
  return [n(m.from), n(m.to)];
});

const ROUTES = ['home', 'play', 'local', 'puzzles', 'saved', 'analysis', 'settings', 'learn'];

await page.setViewport({ width: 1280, height: 800 });
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '#/');
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });
check('app starts with the real modules', (await page.evaluate(() => window.__chess.stubs.length)) === 0, 'stubs: ' + (await page.evaluate(() => window.__chess.stubs.join(','))));

await step('visit pages', async () => {
  for (const r of ROUTES) {
    await go(r === 'home' ? '#/' : `#/${r}`);
    const h1 = await page.$eval('main h1', (e) => e.textContent.trim());
    check(`page ${r} renders a heading`, h1.length > 0, h1);
    await shot(`${r}-1280`);
  }
});

await step('accessibility basics', async () => {
  await go('#/play');
  await ensureBotSetup();
  await page.select('#setup-level', 'lvl1');
  await page.click('.setup-card button[type="submit"]');
  await page.waitForSelector('.board .sq');
  const labels = await page.$$eval('.board .sq', (els) => els.filter((e) => /^[a-h][1-8], /.test(e.getAttribute('aria-label') || '')).length);
  check('all 64 squares have aria-labels', labels === 64, String(labels));
  const unlabeled = await page.$$eval('button', (bs) => bs.filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label'))).length);
  check('every button has an accessible name', unlabeled === 0, String(unlabeled));
});

await step('play against the bot', async () => {
  await clickMove('e2', 'e4');
  await waitBot(2);
  check('click-to-move plays e4 and the bot replies', (await ply()) === 2);
  const ob = await page.$eval('.opening-banner', (e) => ({ eco: e.dataset.eco, text: e.textContent.replace(/\s+/g, ' ').trim(), live: e.querySelector('[aria-live]').getAttribute('aria-live') }));
  check('opening banner names an opening after 1.e4 and a reply', /^[A-E]\d\d$/.test(ob.eco) && ob.text.length > 3, `${ob.eco} ${ob.text}`);
  check('opening banner is a polite live region', ob.live === 'polite');
  check('a bot game keeps the board facing the player after the bot moves', (await page.evaluate(() => window.__chess.controller.board.opts.orientation)) === 'w');
  const [f1, t1] = await pickMove();
  await dragMove(f1, t1);
  await waitBot(4);
  check('drag and drop plays a move and the bot replies', (await ply()) === 4, `${f1}-${t1}`);
  const [f2, t2] = await pickMove();
  await clickMove(f2, t2);
  await waitBot(6);
  check('third move and reply', (await ply()) === 6);
  const san = await page.$$eval('.movelist .mv[data-ply]', (b) => b.length);
  check('move list shows six SAN moves', san === 6, String(san));
  const auto = await page.evaluate(() => JSON.parse(localStorage.getItem('ornate-chess:autosave') || 'null'));
  check('the game is autosaved after each move', auto && auto.game && auto.game.uci.length === 6);
  await page.click('[data-act="hint"]');
  await acceptConfirm(false);
  check('a hint in a bot game does not ask, and the note stays unrated', /not rated/.test(await page.$eval('.rating-note', (e) => e.textContent)) && !(await page.$('dialog[open]')));
  await page.waitForFunction(() => document.querySelectorAll('.board-arrows .arrow').length > 0, { timeout: 30000 });
  check('hint draws an arrow', true);
  await shot('play-game-1280');
  await page.keyboard.press('ArrowLeft');
  check('Left arrow steps back in history', (await page.evaluate(() => window.__chess.controller.viewPly)) === 5);
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await sleep(150);
  const ob1 = await page.$eval('.opening-banner', (e) => [e.dataset.eco, e.querySelector('.ob-name').textContent]);
  check('opening banner follows the viewed position (1.e4 is B00 King\'s Pawn Game)', ob1[0] === 'B00' && ob1[1] === "King's Pawn Game", ob1.join(' '));
  await page.keyboard.press('Home'); await sleep(150);
  const ob0 = await page.$eval('.opening-banner .ob-note', (e) => e.textContent);
  check('opening banner explains the start position in a full sentence', /^No moves have been played yet\./.test(ob0), ob0);
  await page.keyboard.press('End');
  await page.click('[data-act="undo"]');
  await sleep(300);
  check('undo takes back the player move and the bot reply', (await ply()) === 4);
  const [f3, t3] = await pickMove();
  await clickMove(f3, t3);
  await waitBot(6);
});

let savedName = 'Smoke test game';
await step('save a game', async () => {
  await page.click('[data-act="save"]');
  await page.waitForSelector('dialog[open] input');
  await page.$eval('dialog[open] input', (e) => { e.value = ''; });
  await page.type('dialog[open] input', savedName);
  await page.click('dialog[open] .btn.primary');
  await sleep(300);
  const n = await page.evaluate(() => window.__chess.mods.storage.listGames().length);
  check('the game is saved', n === 1, String(n));
});

await step('saved games page loads the game', async () => {
  await go('#/saved');
  const name = await page.$eval('.saved-name', (e) => e.textContent);
  check('saved list shows the game', name === savedName, name);
  const so = await page.$eval('.saved-opening', (e) => e.textContent).catch(() => '');
  check('saved list shows the ECO code and opening name', /^[A-E]\d\d\S/.test(so), so);
  await shot('saved-list-1280');
  await page.click('.saved-item [data-act="analyse"]');
  await page.waitForFunction(() => window.__chess.page === 'analysis' && window.__chess.controller && window.__chess.controller.mode === 'analysis', { timeout: 30000 });
  await sleep(400);
  check('analysis loads the saved game', (await ply()) === 6);
  await page.waitForFunction(() => document.querySelectorAll('.engine-lines .line-btn').length > 0, { timeout: 45000 });
  check('analysis shows engine lines', true);
  await page.click('[data-act="first"]');
  check('analysis navigates to the start', (await page.evaluate(() => window.__chess.controller.viewPly)) === 0);
  await page.click('.movelist .mv[data-ply="3"]');
  await sleep(1200);
  await shot('analysis-game-1280');
  await go('#/saved');
  await page.click('.saved-item [data-act="continue"]');
  await page.waitForFunction(() => window.__chess.page === 'play' && window.__chess.controller && window.__chess.controller.game.moves.length === 6, { timeout: 30000 });
  check('continue loads the game on the Play page', true);
  await go('#/saved');
  await page.click('.saved-item [data-act="rename"]');
  await page.waitForSelector('dialog[open] input');
  await page.$eval('dialog[open] input', (e) => { e.value = ''; });
  await page.type('dialog[open] input', 'Renamed game');
  await page.click('dialog[open] .btn.primary');
  await sleep(300);
  check('rename works', (await page.$eval('.saved-name', (e) => e.textContent)) === 'Renamed game');
  const pgn = await page.evaluate(() => { const st = window.__chess.mods.storage; const g = st.loadGame(st.listGames()[0].id); return window.__chess.mods.storage.exportPgn(g); });
  check('exported PGN includes ECO and Opening headers', /\[ECO "[A-E]\d\d"\]/.test(pgn) && /\[Opening "[^"]+"\]/.test(pgn));
  check('PGN export contains moves', /1\. e4/.test(pgn));
  const exported = await page.evaluate(() => { const st = window.__chess.mods.storage; return st.exportGameFile(st.loadGame(st.listGames()[0].id)); });
  const [fileInput] = await Promise.all([page.$('input[type="file"]')]);
  const tmp = path.join(SHOTS, '..', 'tests', '.smoke-import.json');
  fs.writeFileSync(tmp, exported);
  await fileInput.uploadFile(tmp);
  await page.waitForFunction(() => window.__chess.mods.storage.listGames().length === 2, { timeout: 15000 });
  fs.unlinkSync(tmp);
  check('importing an exported file adds a game', true);
  await page.click('.saved-item [data-act="delete"]');
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn.primary');
  await sleep(300);
  check('delete removes a game', (await page.evaluate(() => window.__chess.mods.storage.listGames().length)) === 1);
});

await step('solve puzzles', async () => {
  await go('#/puzzles');
  const count = await page.$$eval('.puzzle-card', (e) => e.length);
  check('puzzle list shows puzzles', count >= 60, String(count));
  for (const len of [1, 3]) {
    const pz = await page.evaluate((len) => window.__chess.mods.puzzleData.PUZZLES.find((p) => p.solution.length === len && p.solution.every((u) => u.length === 4)), len);
    if (!pz) { check(`a ${len}-move puzzle exists`, false); continue; }
    await go(`#/puzzles/${pz.id}`);
    for (let i = 0; i < pz.solution.length; i += 2) {
      const u = pz.solution[i];
      await clickMove(u.slice(0, 2), u.slice(2, 4));
      await sleep(900);
    }
    const status = await page.$eval('.puzzle-status', (e) => e.textContent);
    check(`puzzle ${pz.id} (${len} plies) is solved`, /solved/i.test(status), status);
    if (len === 3) await shot('puzzle-solved-1280');
  }
  const r = await page.evaluate(() => window.__chess.mods.storage.getRating());
  check('puzzle rating increased', r > 1200, String(r));
  // Wrong move, hint and retry on a fresh puzzle.
  const pz = await page.evaluate(() => window.__chess.mods.puzzleData.PUZZLES.find((p) => p.solution.length === 1 && p.solution[0].length === 4 && p.id !== 'x'));
  await go(`#/puzzles/${pz.id}`);
  await page.click('[data-act="hint"]');
  check('hint highlights the piece', (await page.$$eval('.sq.hint', (e) => e.length)) === 1);
  await shot('puzzle-hint-1280');
  await page.click('[data-act="retry"]');
  await page.click('[data-act="nextpz"]');
  await page.waitForFunction((id) => !location.hash.endsWith(id), {}, pz.id);
  check('next puzzle navigates', true);
});

await step('local two-player game and themes', async () => {
  await go('#/local');
  await page.click('.setup-card button[type="submit"]');
  await page.waitForSelector('.board .sq');
  await clickMove('e2', 'e4'); await sleep(300); await clickMove('e7', 'e5'); await sleep(300);
  await clickMove('d1', 'h5'); await sleep(300); await clickMove('b8', 'c6'); await sleep(300);
  await clickMove('f1', 'c4'); await sleep(300); await clickMove('g8', 'f6'); await sleep(300);
  await clickMove('h5', 'f7');
  await page.waitForSelector('dialog.gameover-dialog[open]', { timeout: 15000 });
  const txt = await page.$eval('dialog[open] .result-text', (e) => e.textContent);
  check('checkmate shows the game-over dialog', /White wins by checkmate/.test(txt), txt);
  await shot('local-gameover-1280');
  await page.click('dialog[open] [data-value="close"]');
  for (const [theme, set, board] of [['ivory', 'ornamental', 'walnut'], ['emerald', 'classic', 'marble'], ['sapphire', 'ornamental', 'marble']]) {
    await page.evaluate((p) => import('./src/ui/state.js').then((m) => m.updateSettings(p)), { theme, pieceSet: set, boardStyle: board });
    await sleep(300);
    await shot(`theme-${theme}-${set}-${board}-1280`);
  }
  await go('#/settings');
  await page.click('input[name="theme"][value="ebony"]');
  await page.click('input[name="showEval"]');
  await sleep(200);
  check('settings change the theme', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'ebony');
  await shot('settings-1280');
});

await step('opening banner in a two-player game', async () => {
  await go('#/local');
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  if (await page.$('dialog[open] .btn.primary')) { await page.click('dialog[open] .btn.primary'); await sleep(300); }
  if (await page.$('.setup-card')) await page.click('.setup-card button[type="submit"]');
  await page.waitForSelector('.board .sq');
  for (const [f, t] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'b5']]) { await clickMove(f, t); await sleep(250); }
  const ob = await page.$eval('.opening-banner', (e) => [e.dataset.eco, e.querySelector('.ob-name').textContent]);
  check('opening banner shows C60 Ruy Lopez after 1.e4 e5 2.Nf3 Nc6 3.Bb5', ob[0] === 'C60' && ob[1] === 'Ruy Lopez', ob.join(' '));
  await (await page.$('.opening-banner')).scrollIntoView();
  await shot('opening-banner-1280');
  for (const [f, t] of [['h7', 'h5'], ['h2', 'h4'], ['h8', 'h6']]) { await clickMove(f, t); await sleep(250); }
  const left = await page.$eval('.opening-banner', (e) => [e.dataset.eco, e.querySelector('.ob-note').textContent]);
  check('after leaving theory the banner keeps the last named opening', /^[A-E]\d\d$/.test(left[0]) && /left the known opening lines/.test(left[1]), left.join(' '));
  const pgn = await page.evaluate(() => window.__chess.controller.pgn());
  check('controller PGN has ECO and Opening headers', /\[ECO "[A-E]\d\d"\]/.test(pgn) && /\[Opening "/.test(pgn));
});

await step('promotion dialog', async () => {
  await go('#/analysis');
  await page.$eval('.load-panel', (d) => { d.open = true; });
  await page.$eval('#an-fen', (e) => { e.value = ''; });
  await page.type('#an-fen', '8/4P1k1/8/8/8/8/6K1/8 w - - 0 1');
  await page.click('[data-load="fen"]');
  await sleep(400);
  check('FEN loads into analysis', (await page.evaluate(() => window.__chess.controller.game.position.toFen())).startsWith('8/4P1k1'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await clickMove('e7', 'e8');
  await page.waitForSelector('dialog.promo-dialog[open]', { timeout: 10000 });
  await shot('promotion-1280');
  await page.click('dialog[open] [data-value="n"]');
  await sleep(300);
  const p = await page.evaluate(() => window.__chess.controller.game.position.board[60]);
  check('promotion to a knight', p && p.type === 'n', JSON.stringify(p));
});

await step('clock, thinking indicator and cancel on undo', async () => {
  await go('#/play');
  await ensureBotSetup();
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  await page.select('#setup-level', 'lvl8');
  await page.select('#setup-clock', '3+2');
  await page.click('.setup-card button[type="submit"]');
  await page.waitForSelector('.board .sq');
  await page.evaluate(() => {
    window.__sawThinking = false;
    const t = document.querySelector('.thinking');
    new MutationObserver(() => { if (!t.classList.contains('hidden')) window.__sawThinking = true; }).observe(t, { attributes: true });
  });
  await clickMove('h2', 'h4');
  await page.waitForFunction(() => window.__sawThinking, { timeout: 15000 });
  check('the thinking indicator is shown while the bot searches', true);
  await sleep(300);
  const clocks = await page.$$eval('.pb-clock', (e) => e.map((x) => x.textContent));
  check('clocks are shown', clocks.length === 2 && clocks.every((c) => /\d:\d\d/.test(c)), clocks.join(' / '));
  await shot('play-thinking-clock-1280');
  await page.click('[data-act="undo"]');
  await acceptConfirm(false);
  await sleep(300);
  const st = await page.evaluate(() => ({ n: window.__chess.controller.game.moves.length, hidden: document.querySelector('.thinking').classList.contains('hidden') }));
  check('undo cancels the bot search', st.n === 0 && st.hidden, JSON.stringify(st));
  await sleep(3500);
  check('no bot move arrives after cancel', (await ply()) === 0);
  await page.click('[data-act="resign"]');
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn.primary');
  await page.waitForSelector('dialog.gameover-dialog[open]', { timeout: 15000 });
  check('resigning ends the game', /resignation/.test(await page.$eval('dialog[open] .result-text', (e) => e.textContent)));
  await page.click('dialog[open] [data-value="new"]');
  await sleep(300);
});

async function typeInto(sel, text) { await page.focus(sel); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.type(sel, text); await sleep(80); }

const orient = () => page.evaluate(() => ({ o: window.__chess.controller.board.opts.orientation, first: document.querySelector('.board .sq').dataset.square, ply: window.__chess.controller.viewPly, persp: (window.__chess.mods && document.querySelector('input[name="board-perspective"]:checked') || {}).value || null }));
await step('two-player board flips with the side to move', async () => {
  await go('#/local');
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  if (await page.$('dialog[open] .btn.primary')) { await page.click('dialog[open] .btn.primary'); await sleep(300); }
  await page.waitForSelector('.setup-card input[name="rotate"]');
  check('Flip the board after each move is on by default', await page.$eval('.setup-card input[name="rotate"]', (e) => e.checked && /Flip the board after each move/.test(e.closest('label').textContent)));
  await page.click('.setup-card button[type="submit"]');
  await page.waitForSelector('.board .sq');
  let o = await orient();
  check('a new two-player game starts from White\'s view', o.o === 'w' && o.first === 'a8', JSON.stringify(o));
  check('the perspective control defaults to Auto', await page.$eval('input[name="board-perspective"][value="auto"]', (e) => e.checked));
  await clickMove('e2', 'e4'); await sleep(300);
  o = await orient();
  check('after 1.e4 the board shows Black\'s view', o.o === 'b' && o.first === 'h1', JSON.stringify(o));
  await page.click('[data-act="undo"]'); await sleep(300);
  o = await orient();
  check('after Undo the board flips back to White\'s view', o.o === 'w' && o.first === 'a8', JSON.stringify(o));
  await page.click('[data-act="redo"]'); await sleep(300);
  o = await orient();
  check('after Redo the board shows Black\'s view again', o.o === 'b' && (await ply()) === 1, JSON.stringify(o));
  await clickMove('e7', 'e5'); await sleep(300);
  check('after 1...e5 the board shows White\'s view', (await orient()).o === 'w');
  // History navigation must not flip the board.
  await page.click('.movelist .mv[data-ply="1"]'); await sleep(300);
  o = await orient();
  check('selecting 1.e4 in the move list does not flip the board', o.o === 'w' && o.ply === 1, JSON.stringify(o));
  await page.click('[data-act="prev"]'); await sleep(200);
  o = await orient();
  check('the Previous arrow does not flip the board', o.o === 'w' && o.ply === 0, JSON.stringify(o));
  await page.click('[data-act="next"]'); await sleep(200);
  await page.click('[data-act="next"]'); await sleep(200);
  o = await orient();
  check('the Next arrow does not flip the board', o.o === 'w' && o.ply === 2, JSON.stringify(o));
  await page.click('[data-act="first"]'); await sleep(200);
  check('the First arrow does not flip the board', (await orient()).o === 'w');
  await page.click('[data-act="last"]'); await sleep(200);
  check('the Last arrow does not flip the board', (await orient()).o === 'w' && (await page.evaluate(() => window.__chess.controller.viewPly)) === 2);
  await page.keyboard.press('Home'); await sleep(200);
  check('keyboard Home navigation does not flip the board', (await orient()).o === 'w');
  await page.keyboard.press('End'); await sleep(200);
  check('keyboard End navigation does not flip the board', (await orient()).o === 'w');
  // Manual Flip inverts Auto and stays while navigating.
  await page.click('[data-act="flip"]'); await sleep(200);
  check('a manual Flip inverts the Auto view', (await orient()).o === 'b');
  await page.click('[data-act="prev"]'); await sleep(200);
  check('the manual Flip stays in effect while navigating history', (await orient()).o === 'b');
  await page.click('[data-act="flip"]'); await sleep(200);
  check('a second Flip restores the Auto view', (await orient()).o === 'w');
  await page.click('[data-act="last"]'); await sleep(200);
  await go('#/home'); await go('#/local');
  check('returning to the page keeps the derived orientation', (await orient()).o === 'w');
});

await step('perspective control forces White or Black and persists', async () => {
  await go('#/local');
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  if (await page.$('dialog[open] .btn.primary')) { await page.click('dialog[open] .btn.primary'); await sleep(300); }
  await page.waitForSelector('.setup-card button[type="submit"]');
  await page.click('.setup-card button[type="submit"]');
  await page.waitForSelector('.board .sq');
  await clickMove('e2', 'e4'); await sleep(300);
  check('Auto after 1.e4 faces Black', (await orient()).o === 'b');
  await page.click('input[name="board-perspective"][value="w"]'); await sleep(200);
  check('choosing White locks White\'s view after Black to move', (await orient()).o === 'w');
  await clickMove('e7', 'e5'); await sleep(300);
  check('White lock stays after the next move', (await orient()).o === 'w');
  await page.click('input[name="board-perspective"][value="b"]'); await sleep(200);
  check('choosing Black locks Black\'s view', (await orient()).o === 'b');
  await page.click('[data-act="flip"]'); await sleep(200);
  check('Flip while locked switches the lock to White', (await orient()).o === 'w' && await page.$eval('input[name="board-perspective"][value="w"]', (e) => e.checked));
  await page.$eval('.perspective-ctrl', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  await shot('perspective-control-1280');
  // Persist across a route change.
  await go('#/home'); await go('#/local');
  check('the White perspective persists after leaving the page', await page.$eval('input[name="board-perspective"][value="w"]', (e) => e.checked) && (await orient()).o === 'w');
  const stored = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('ornate-chess:gui-prefs') || '{}').boardPerspective; } catch { return null; }
  });
  check('boardPerspective is stored under ornate-chess:gui-prefs', stored === 'w', String(stored));
  await page.click('input[name="board-perspective"][value="auto"]'); await sleep(200);
  check('returning to Auto restores side-to-move orientation', (await orient()).o === 'w');
});

await step('analysis defaults to White\'s perspective', async () => {
  await go('#/analysis');
  await page.waitForSelector('.board .sq');
  // Ensure Auto, then load a short PGN that ends with Black to move.
  await page.evaluate(() => import('./src/ui/state.js').then((m) => m.updateSettings({ boardPerspective: 'auto' })));
  await page.$eval('.load-panel', (e) => { e.open = true; });
  await sleep(100);
  await page.$eval('#an-pgn', (e) => { e.value = '1. e4 e5 2. Nf3'; });
  await page.click('.load-panel [data-load="pgn"]');
  await page.waitForFunction(() => window.__chess.controller && window.__chess.controller.mode === 'analysis' && window.__chess.controller.game.moves.length === 3, { timeout: 30000 });
  await sleep(300);
  let o = await orient();
  check('analysis Auto defaults to White even when Black is to move', o.o === 'w' && o.first === 'a8', JSON.stringify(o));
  check('analysis Auto stays White while Black is to move in the live game', await page.evaluate(() => window.__chess.controller.game.position.turn) === 'b');
  await page.click('input[name="board-perspective"][value="b"]'); await sleep(200);
  check('analysis can lock Black\'s perspective', (await orient()).o === 'b');
  await page.click('input[name="board-perspective"][value="auto"]'); await sleep(200);
  check('analysis Auto returns to White', (await orient()).o === 'w');
  await page.click('.game-root [data-act="prev"]'); await sleep(200);
  check('analysis history navigation keeps White\'s view', (await orient()).o === 'w');
});

await step('custom clock', async () => {
  await go('#/local');
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  await page.waitForSelector('.setup-card [data-setup="custom"]');
  await page.click('[data-setup="custom"]');
  await sleep(150);
  const open = await page.$eval('#custom-clock', (e) => !e.hidden && e.getBoundingClientRect().height > 0);
  check('the Custom button reveals the custom time fields', open);
  check('the preset list is disabled with a visible reason', await page.$eval('#setup-clock', (e) => e.disabled) && /preset list is not used/.test(await page.$eval('#clock-preset-note', (e) => e.textContent)));
  await typeInto('#cc-min', '0.2');
  const err = await page.$eval('.cc-errors', (e) => ({ role: e.getAttribute('role'), text: e.textContent }));
  const startDisabled = await page.$eval('.setup-card button[type="submit"]', (b) => b.disabled);
  const reason = await page.$eval('#start-reason', (e) => (e.hidden ? '' : e.textContent));
  check('an out-of-range value shows an alert and disables Start with a reason', err.role === 'alert' && /between 0.5 and 180/.test(err.text) && startDisabled && /cannot start/.test(reason), `${err.text} | ${reason}`);
  await typeInto('#cc-min', '7');
  await typeInto('#cc-inc', '3');
  const sum = await page.$eval('.clock-summary', (e) => e.textContent);
  check('the summary names the custom time', /7 minutes plus 3 seconds per move/.test(sum), sum);
  check('Start is enabled for a valid custom time', !(await page.$eval('.setup-card button[type="submit"]', (b) => b.disabled)));
  await page.$eval('#custom-clock', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  await shot('custom-timer-1280');
  await page.click('.setup-card button[type="submit"]');
  await page.waitForSelector('.board .sq');
  await sleep(200);
  const clocks = await page.$$eval('.pb-clock', (e) => e.map((x) => x.textContent));
  check('a custom 7+3 clock shows 7:00 for both players', clocks.length === 2 && clocks.every((c) => c === '7:00'), clocks.join(' / '));
  const inc = await page.evaluate(() => window.__chess.controller.clock.snapshot());
  check('the custom increment is used for the game', inc.incMs === 3000 && inc.wMs === 420000 && inc.bMs === 420000, JSON.stringify(inc));
  await clickMove('e2', 'e4'); await sleep(300);
  await page.click('.game-root [data-act="new"]'); await sleep(300);
  if (await page.$('dialog[open] .btn.primary')) { await page.click('dialog[open] .btn.primary'); await sleep(300); }
  await page.waitForSelector('.setup-card [data-setup="custom"]');
  const pre = await page.evaluate(() => ({ open: !document.querySelector('#custom-clock').hidden, min: document.querySelector('#cc-min').value, inc: document.querySelector('#cc-inc').value }));
  check('the last custom values are preselected', pre.open && pre.min === '7' && pre.inc === '3', JSON.stringify(pre));
  await page.click('[data-setup="custom"]'); await sleep(100);
  check('selecting Custom again returns to the presets', !(await page.$eval('#setup-clock', (e) => e.disabled)));
});

await step('mobile layout', async () => {
  await page.setViewport({ width: 390, height: 800, deviceScaleFactor: 1 });
  await page.evaluate(() => import('./src/ui/state.js').then((m) => m.updateSettings({ theme: 'ebony', pieceSet: 'classic', boardStyle: 'marble' })));
  for (const r of ROUTES) {
    await go(r === 'home' ? '#/' : `#/${r}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`page ${r} fits 390px wide`, overflow <= 1, `overflow ${overflow}px`);
    await shot(`${r}-390`);
  }
  await go('#/play');
  await ensureBotSetup();
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  if (await page.$('.setup-card')) {
    await page.click('[data-setup="custom"]'); await sleep(150);
    const ov = await page.evaluate(() => { const f = document.querySelector('#custom-clock').getBoundingClientRect(); return { page: document.documentElement.scrollWidth - window.innerWidth, right: f.right }; });
    check('the custom clock fields fit at 390px wide', ov.page <= 1 && ov.right <= 390, JSON.stringify(ov));
    await page.$eval('#custom-clock', (e) => e.scrollIntoView({ block: 'center' }));
    await sleep(150);
    await shot('custom-timer-390');
    await page.click('[data-setup="custom"]'); await sleep(100);
    await page.select('#setup-level', 'lvl1'); await page.click('.setup-card button[type="submit"]');
  }
  await page.waitForSelector('.board .sq');
  await clickMove('e2', 'e4');
  await waitBot(2);
  check('a move works at 390px wide', (await ply()) === 2);
  await shot('play-game-390');
  const ob390 = await page.$eval('.opening-banner', (e) => { const r = e.getBoundingClientRect(); return { eco: e.dataset.eco, w: r.width, right: r.right }; });
  check('opening banner fits at 390px wide', /^[A-E]\d\d$/.test(ob390.eco) && ob390.right <= 390, JSON.stringify(ob390));
  await page.$eval('.opening-banner', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  await shot('opening-banner-390');
  await page.$eval('.perspective-ctrl', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  const perspFit = await page.evaluate(() => {
    const el = document.querySelector('.perspective-ctrl');
    const r = el.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, right: r.right, labels: [...el.querySelectorAll('input[name="board-perspective"]')].map((i) => i.value) };
  });
  check('the perspective control fits at 390px wide', perspFit.overflow <= 1 && perspFit.right <= 390 && perspFit.labels.join(',') === 'auto,w,b', JSON.stringify(perspFit));
  await shot('perspective-control-390');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(200);
  await shot('play-game-390-controls');
});

// ---------------------------------------------------------------- player rating
async function newBotGame(level) {
  await go('#/play');
  await ensureBotSetup();
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  if (await page.$('dialog[open] .btn.primary')) { await page.click('dialog[open] .btn.primary'); await sleep(300); }
  if (await page.$('[data-setup="discard"]')) { await page.click('[data-setup="discard"]'); await page.waitForSelector('dialog[open]'); await page.click('dialog[open] .btn.primary'); await sleep(300); }
  await page.waitForSelector('.setup-card #setup-level');
  await page.select('#setup-level', level);
  await page.select('#setup-clock', 'none').catch(() => null);
  await page.click('.setup-card button[type="submit"]');
  await page.waitForSelector('.board .sq');
  await sleep(200);
}

await step('online ratings and unrated bot games', async () => {
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluate(() => {
    localStorage.removeItem('ornate-chess:player-rating');
    localStorage.removeItem('ornate-chess:online-ratings');
    localStorage.removeItem('ornate-chess:autosave');
  });
  await go('#/');
  const home0 = await page.$eval('.rating-panel', (e) => ({
    figs: [...e.querySelectorAll('.rating-figure')].map((n) => n.textContent.trim()),
    text: e.textContent,
  }));
  check('the Home page shows a provisional rating for bullet, blitz and rapid', home0.figs.join(',') === '1500?,1500?,1500?', home0.figs.join(','));
  check('the Home page says a bot game does not change the ratings', /bot does not change/.test(home0.text));
  check('the Home page says the ratings are not Chess.com, Lichess or FIDE ratings', /not Chess\.com, Lichess or FIDE ratings\./.test(home0.text));
  check('the Home page explains that each chart appears after the first rated game', /after its first rated game/.test(home0.text));
  await page.$eval('.rating-panel', (e) => e.scrollIntoView({ block: 'center' })); await sleep(150);
  await shot('rating-home-1280');

  await go('#/play');
  await ensureBotSetup();
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  if (await page.$('dialog[open] .btn.primary')) { await page.click('dialog[open] .btn.primary'); await sleep(300); }
  await page.waitForSelector('.setup-card');
  check('the bot setup has no Rated option', !(await page.$('.setup-card input[name="rated"]')));
  check('the bot setup says the game is not rated', /not rated/.test(await page.$eval('.setup-card', (e) => e.textContent)));
  await page.$eval('.setup-card', (e) => e.scrollIntoView({ block: 'center' })); await sleep(100);
  await shot('rating-setup-1280');
  check('two-player setup has no Rated option', await (async () => { await go('#/local'); return !(await page.$('.setup-card input[name="rated"]')); })());

  await newBotGame('lvl1');
  check('the game sidebar says a bot game is not rated', /not rated/.test(await page.$eval('.rating-note', (e) => e.textContent)));
  await page.click('[data-act="new"]'); await sleep(300);
  check('New game does not ask to count the bot game as a loss', !(await page.$('dialog[open]')));

  await go('#/settings');
  const summary = await page.$eval('.rating-summary', (e) => e.textContent);
  check('Settings lists bullet, blitz and rapid at 1500?', /Bullet is 1500\?/.test(summary) && /Blitz is 1500\?/.test(summary) && /Rapid is 1500\?/.test(summary), summary);
  check('Settings has no button that resets a rating', !(await page.$('[data-act="reset-rating"]')));
  check('Settings says a rating cannot be reset from this page', /cannot be reset from this page/.test(await page.$eval('main', (e) => e.textContent)));
});

// ---------------------------------------------------------------- right-click annotations
async function center(name) { await page.$eval(sq(name), (e) => { const r = e.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) e.scrollIntoView({ block: 'center' }); }); const b = await (await page.$(sq(name))).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
async function withMods(mods, fn) { for (const m of mods) await page.keyboard.down(m); try { await fn(); } finally { for (const m of mods.slice().reverse()) await page.keyboard.up(m); } }
async function rightClick(name, mods = []) { await withMods(mods, async () => { const [x, y] = await center(name); await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); }); await sleep(60); }
async function rightDrag(a, b, mods = []) {
  await withMods(mods, async () => {
    const [x1, y1] = await center(a), [x2, y2] = await center(b);
    await page.mouse.move(x1, y1); await page.mouse.down({ button: 'right' });
    await page.mouse.move(x2, y2, { steps: 6 }); await page.mouse.up({ button: 'right' });
  });
  await sleep(60);
}
const marks = () => page.evaluate(() => ({
  hl: Object.fromEntries([...document.querySelectorAll('.board .sq.annot')].map((e) => [e.dataset.square, e.dataset.annot])),
  arrows: [...document.querySelectorAll('.board-arrows .annot-arrow')].map((p) => `${p.dataset.from}-${p.dataset.to}:${p.dataset.color}`).sort(),
}));
async function boardShot(name) {
  const host = await page.$('.board-host');
  await host.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(120);
  await host.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

await step('right-click annotations', async () => {
  await page.setViewport({ width: 1280, height: 800 });
  await newBotGame('lvl1', { rated: false });
  await page.evaluate(() => {
    window.__ctx = [];
    document.addEventListener('contextmenu', (e) => window.__ctx.push({ board: !!(e.target.closest && e.target.closest('.board')), prevented: e.defaultPrevented }));
  });
  await rightClick('e4');
  let m = await marks();
  check('a right-click highlights a square in gold', m.hl.e4 === 'gold' && Object.keys(m.hl).length === 1, JSON.stringify(m));
  await rightClick('e4');
  check('a second right-click removes the highlight', Object.keys((await marks()).hl).length === 0);
  await rightClick('e4');
  await rightClick('d5', ['Shift']);
  await rightClick('c6', ['Control']);
  await rightClick('f6', ['Alt']);
  await rightClick('b5', ['Control', 'Shift']);
  m = await marks();
  check('Shift, Ctrl, Alt and Ctrl+Shift choose green, red, blue and blue', m.hl.e4 === 'gold' && m.hl.d5 === 'green' && m.hl.c6 === 'red' && m.hl.f6 === 'blue' && m.hl.b5 === 'blue', JSON.stringify(m.hl));
  await rightClick('b5', ['Control', 'Shift']);
  await rightDrag('e2', 'e4');
  await rightDrag('g1', 'f3', ['Control']);
  await rightDrag('d2', 'd4', ['Shift']);
  await rightDrag('b1', 'c3', ['Alt']);
  await rightDrag('f1', 'b5');
  m = await marks();
  check('right-drags draw arrows in the chosen colours', m.arrows.join(',') === 'b1-c3:blue,d2-d4:green,e2-e4:gold,f1-b5:gold,g1-f3:red', m.arrows.join(','));
  const knight = await page.$eval('.annot-arrow[data-from="g1"][data-to="f3"]', (p) => p.getAttribute('d').split('L').length);
  const straight = await page.$eval('.annot-arrow[data-from="e2"][data-to="e4"]', (p) => p.getAttribute('d').split('L').length);
  check('the knight arrow is L-shaped (two more outline points than a straight arrow)', knight === straight + 2, `${knight} vs ${straight}`);
  await rightDrag('f1', 'b5');
  check('repeating the same arrow removes it', !(await marks()).arrows.some((a) => a.startsWith('f1-b5')));
  await rightDrag('f1', 'b5');
  const ctx = await page.evaluate(() => window.__ctx);
  check('the browser context menu is suppressed on the board', ctx.length > 0 && ctx.every((c) => c.board && c.prevented), JSON.stringify(ctx.slice(0, 3)));
  await page.click('.status', { button: 'right' }); await sleep(80);
  const off = await page.evaluate(() => window.__ctx[window.__ctx.length - 1]);
  check('the context menu is not suppressed outside the board', off && !off.board && !off.prevented, JSON.stringify(off));
  check('annotations do not change the game', (await ply()) === 0);
  await boardShot('annotations-1280');
  await shot('annotations-page-1280');

  // Flipping the board keeps the marks on the same squares and redraws the arrows.
  const before = await page.$eval('.annot-arrow[data-from="g1"]', (p) => p.getAttribute('d'));
  await page.click('[data-act="flip"]'); await sleep(200);
  const flipped = await marks();
  const after = await page.$eval('.annot-arrow[data-from="g1"]', (p) => p.getAttribute('d'));
  check('after a flip the highlights stay on their squares', flipped.hl.e4 === 'gold' && flipped.hl.c6 === 'red' && (await page.evaluate(() => window.__chess.controller.board.opts.orientation)) === 'b');
  check('after a flip the arrows are redrawn for Black\'s view', flipped.arrows.length === 5 && before !== after);
  const e4box = await page.$eval('.annot-arrow[data-from="e2"]', (p) => { const b = p.getBBox(); return b.y; });
  check('the e2-e4 arrow points down the board from Black\'s side', e4box < 400, String(e4box));
  await boardShot('annotations-flipped-1280');
  await page.click('[data-act="flip"]'); await sleep(200);

  // A left click on the board clears every mark, without selecting anything odd.
  await page.click(sq('a5')); await sleep(100);
  m = await marks();
  check('a left click on the board clears all annotations', Object.keys(m.hl).length === 0 && m.arrows.length === 0, JSON.stringify(m));

  // Dragging a piece still works with annotations on the board, and the move clears them.
  await rightDrag('e2', 'e4'); await rightClick('d4');
  await dragMove('e2', 'e4');
  await waitBot(2);
  m = await marks();
  check('a piece can be dragged while annotations are shown, and they are cleared', (await ply()) === 2 && m.arrows.length === 0 && Object.keys(m.hl).length === 0);
  // A move played without a left click (for example by the bot) also clears them.
  await rightDrag('d2', 'd4', ['Shift']);
  await page.evaluate(() => { const c = window.__chess.controller; const mv = c.game.position.legalMoves().find((x) => !x.promotion); c.userMove(mv); });
  await sleep(150);
  check('making a move clears the annotations', (await marks()).arrows.length === 0);
  await waitBot(4);
  // History navigation changes the shown position, so the marks are cleared.
  await rightDrag('a2', 'a4'); await rightClick('h7', ['Control']);
  await page.keyboard.press('ArrowLeft'); await sleep(150);
  m = await marks();
  check('history navigation clears the annotations', m.arrows.length === 0 && Object.keys(m.hl).length === 0);
  await rightClick('e5', ['Alt']);
  check('annotations can be drawn on an earlier position', (await marks()).hl.e5 === 'blue');
  await page.keyboard.press('End'); await sleep(150);
  check('returning to the current position clears them again', Object.keys((await marks()).hl).length === 0);

  // Two-player, analysis and puzzle boards.
  await go('#/local');
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  if (await page.$('[data-setup="discard"]')) { await page.click('[data-setup="discard"]'); await page.waitForSelector('dialog[open]'); await page.click('dialog[open] .btn.primary'); await sleep(300); }
  if (await page.$('.setup-card button[type="submit"]')) { await page.click('.setup-card button[type="submit"]'); }
  await page.waitForSelector('.board .sq');
  await rightDrag('b1', 'c3', ['Shift']);
  const lm = await marks();
  check('annotations work on the two-player board', lm.arrows.join() === 'b1-c3:green', JSON.stringify(lm) + await page.evaluate(() => document.querySelectorAll('.board').length + ' ' + (window.__chess.controller && window.__chess.controller.game.position.toFen())));
  await go('#/analysis');
  await page.waitForSelector('.board .sq');
  await rightClick('d4', ['Control']);
  const am = await marks();
  check('annotations work on the analysis board', am.hl.d4 === 'red', JSON.stringify(am));
  await go('#/puzzles');
  await page.waitForSelector('.puzzle-card');
  await page.click('.puzzle-card'); await page.waitForSelector('.board .sq'); await sleep(300);
  const pzSquare = await page.$eval('.board .sq', (e) => e.dataset.square);
  await rightClick(pzSquare);
  check('annotations work on the puzzle board', (await marks()).hl[pzSquare] === 'gold');
  await page.click(sq(pzSquare)); await sleep(100);
  check('a left click clears the puzzle board annotations', Object.keys((await marks()).hl).length === 0);

  // The controls are described in one sentence in the shortcuts.
  await go('#/learn');
  check('the Learn page describes the right-click controls', /right-click a square to highlight it.+left-click the board to clear every mark\./.test(await page.$eval('.annot-help', (e) => e.textContent)));
});

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (problems.length) { console.log(`Console or network problems (${problems.length}):`); problems.forEach((p) => console.log('  ' + p)); }
else console.log('No console errors, page errors or failed requests.');
process.exit(failed.length || problems.length ? 1 : 0);
