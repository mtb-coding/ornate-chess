// GUI sound test. Emulates a phone and replaces AudioContext with a recording
// fake that behaves like iOS Safari: it starts suspended, resume() only works
// while a trusted gesture event is being handled, and the test can interrupt it, hide the page or
// freeze its clock. Checks that taps, bot replies, move stepping and the
// settings test button all reach a started sound, and that the sound recovers
// after the page is backgrounded.
// Run: node tests/gui-sound.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { startServer } from './gui-static-server.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER || '/workspace/.ptools/node_modules/puppeteer-core');
const CHROME = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/opt/ungoogled-chromium/chrome'].find((p) => fs.existsSync(p));
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const FAKE = () => {
  const contexts = [];
  let hidden = false;
  // iOS only lets resume() work while a gesture handler is running, unlike
  // Chrome's five-second transient activation, so model the stricter rule.
  let inGesture = false;
  for (const t of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown']) {
    window.addEventListener(t, (e) => { if (e.isTrusted) { inGesture = true; setTimeout(() => { inGesture = false; }, 0); } }, { capture: true });
  }
  Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible'), configurable: true });
  Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
  class Node { connect(n) { return n || this; } disconnect() {} }
  class FakeAudioContext extends EventTarget {
    constructor() {
      super();
      this.state = 'suspended'; this.sampleRate = 48000; this.destination = new Node();
      this.starts = []; this.stops = 0; this.clock = 0; this.runSince = null; this.frozen = false; this.onstatechange = null;
      contexts.push(this);
    }
    get currentTime() { return this.clock + (this.state === 'running' && !this.frozen && this.runSince != null ? (performance.now() - this.runSince) / 1000 : 0); }
    setState(s) {
      if (this.state === 'running' && this.runSince != null && !this.frozen) this.clock += (performance.now() - this.runSince) / 1000;
      this.runSince = s === 'running' ? performance.now() : null;
      this.state = s;
      this.dispatchEvent(new Event('statechange'));
      if (this.onstatechange) this.onstatechange();
    }
    resume() {
      if (this.state === 'closed') return Promise.reject(new Error('closed'));
      if (inGesture) { this.setState('running'); return Promise.resolve(); }
      return Promise.reject(new Error('NotAllowedError'));
    }
    close() { this.setState('closed'); return Promise.resolve(); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { length: len, getChannelData: () => d }; }
    createBufferSource() { const c = this; const n = new Node(); n.buffer = null; n.onended = null; n.start = function () { c.starts.push(this.buffer ? this.buffer.length : 0); }; n.stop = () => { c.stops++; }; return n; }
    createGain() { const n = new Node(); n.gain = { value: 1 }; return n; }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
  window.__fakeAudio = {
    contexts,
    live: () => contexts.filter((c) => c.state !== 'closed').pop() || null,
    setHidden(h) { hidden = h; document.dispatchEvent(new Event('visibilitychange')); },
  };
};

const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.emulate({ viewport: PHONE, userAgent: PHONE_UA });
await page.evaluateOnNewDocument(FAKE);
const problems = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }
async function step(name, fn) { try { await fn(); } catch (err) { check(name, false, err.message.split('\n')[0]); } }
async function go(route) {
  await page.evaluate((r) => { location.hash = r; }, route);
  const id = route.replace(/^#\/?/, '').split('/')[0] || 'home';
  await page.waitForFunction((id) => window.__chess && window.__chess.ready && window.__chess.page === id, { timeout: 30000 }, id);
  await sleep(400);
}
async function tapSquare(name) {
  const sel = `.board .sq[data-square="${name}"]`;
  await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center', inline: 'center' }));
  await sleep(60);
  const p = await page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(p.x, p.y);
  await sleep(120);
}
const ply = () => page.evaluate(() => window.__chess.controller.game.moves.length);
async function waitBot(n) {
  await page.waitForFunction((n) => { const c = window.__chess.controller; return c && c.game.moves.length >= n && c.game.position.turn === c.playerColor; }, { timeout: 20000 }, n);
  await sleep(250);
}
// Audible sounds started so far, across every context, named by buffer length.
const sounds = () => page.evaluate(async () => {
  const m = await import(new URL('src/ui/sound.js', location.href).href);
  const names = {};
  for (const k of m.SOUND_KINDS) names[m.synthesize(k, 48000).length] = k;
  return window.__fakeAudio.contexts.flatMap((c) => c.starts.filter((n) => n > 1).map((n) => names[n] || '?'));
});
const state = () => page.evaluate(async () => (await import(new URL('src/ui/sound.js', location.href).href)).audioState());
const expectedKind = () => page.evaluate(async () => {
  const m = await import(new URL('src/ui/sound.js', location.href).href);
  const c = window.__chess.controller; const g = c.game;
  return m.soundForMove(g.moves[g.moves.length - 1], g.position);
});
const pickMove = () => page.evaluate(() => {
  const pos = window.__chess.controller.game.position; const n = (s) => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
  const ms = pos.legalMoves().filter((m) => !m.promotion); const m = ms.find((x) => x.captured) || ms[Math.floor(ms.length / 2)];
  return [n(m.from), n(m.to)];
});
async function playOneTurn() {
  const n = await ply();
  const [f, t] = await pickMove();
  await tapSquare(f); await tapSquare(t);
  await waitBot(n + 2);
}

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '#/');
await page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 20000 });
check('the fake AudioContext is installed', await page.evaluate(() => !!window.__fakeAudio));
check('no audio context exists before the first tap', !(await state()).hasContext);

async function ensureBotSetup() {
  if (await page.$('.setup-card') || await page.$('.game-root')) return;
  const bot = await page.$('[data-play="bot"]');
  if (!bot) return;
  await bot.click();
  await page.waitForSelector('.setup-card, .game-root', { timeout: 5000 });
}

await step('bot game: tap moves and bot replies play sounds', async () => {
  await go('#/play');
  await ensureBotSetup();
  if (await page.$('.game-root [data-act="new"]')) { await page.click('.game-root [data-act="new"]'); await sleep(300); }
  if (await page.$('dialog[open] .btn.primary')) { await page.click('dialog[open] .btn.primary'); await sleep(300); }
  await page.waitForSelector('.setup-card button[type="submit"]');
  await page.select('#setup-level', 'lvl1');
  await (await page.$('.setup-card button[type="submit"]')).tap();
  await page.waitForSelector('.board .sq');
  await sleep(300);
  const s0 = (await sounds()).length;
  await tapSquare('e2'); await tapSquare('e4');
  const afterUser = await sounds();
  check('the tapped move e4 plays a "move" sound', afterUser.length === s0 + 1 && afterUser[afterUser.length - 1] === 'move', afterUser.join());
  check('the tap unlocked the shared context', (await state()).state === 'running');
  await waitBot(2);
  const afterBot = await sounds();
  const want = await expectedKind();
  check('the bot reply, made outside any gesture, plays its sound', afterBot.length === s0 + 2 && afterBot[afterBot.length - 1] === want, `${afterBot.join()} want ${want}`);
  check('one audio context serves the whole game', (await page.evaluate(() => window.__fakeAudio.contexts.length)) === 1);
});

await step('backgrounding: interrupted context recovers on the next tap', async () => {
  await page.evaluate(() => { window.__fakeAudio.setHidden(true); window.__fakeAudio.live().setState('interrupted'); });
  await sleep(100);
  await page.evaluate(() => window.__fakeAudio.setHidden(false));
  await sleep(400);
  check('returning without a tap cannot resume an interrupted iOS context', (await state()).state === 'interrupted');
  const s0 = (await sounds()).length;
  await playOneTurn();
  const s = await sounds();
  check('after returning, the tapped move and the bot reply both play', s.length === s0 + 2, s.slice(s0).join());
  check('the context is running again after the tap', (await state()).state === 'running');
});

await step('a frozen "running" context is replaced on the next tap', async () => {
  await page.evaluate(() => { window.__fakeAudio.setHidden(true); window.__fakeAudio.live().frozen = true; window.__fakeAudio.setHidden(false); });
  await sleep(600);
  check('the frozen clock is detected after returning to the page', (await state()).dead === true);
  const nCtx = await page.evaluate(() => window.__fakeAudio.contexts.length);
  const s0 = (await sounds()).length;
  await playOneTurn();
  const s = await sounds();
  check('a new context replaced the frozen one', (await page.evaluate(() => window.__fakeAudio.contexts.length)) === nCtx + 1 && (await state()).state === 'running');
  check('the move and bot reply after the replacement both play', s.length === s0 + 2, s.slice(s0).join());
});

await step('stepping through moves plays a sound for each forward step', async () => {
  const total = await ply();
  const s0 = (await sounds()).length;
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await sleep(100);
  const sBack = (await sounds()).length;
  check('stepping back is silent', sBack === s0);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await sleep(150);
  const s = await sounds();
  check('four quick forward steps with the arrow keys play four sounds', s.length === s0 + 4, s.slice(s0).join());
  check('stepping ends on the last move', (await page.evaluate(() => window.__chess.controller.viewPly)) === total);
  await page.keyboard.press('ArrowLeft'); await sleep(50);
  const s1 = (await sounds()).length;
  await page.$eval('[data-act="next"]', (e) => e.scrollIntoView({ block: 'center' })); await sleep(100);
  await (await page.$('[data-act="next"]')).tap(); await sleep(150);
  check('tapping the next-move button plays a sound', (await sounds()).length === s1 + 1);
  const st = await state();
  check('rapid sounds were never cut off by the voice limit', st.voices <= 8);
});

await step('settings: test sound and mute', async () => {
  await go('#/settings');
  const s0 = (await sounds()).length;
  await page.$eval('[data-act="test-sound"]', (e) => e.scrollIntoView({ block: 'center' })); await sleep(100);
  await (await page.$('[data-act="test-sound"]')).tap(); await sleep(150);
  const s = await sounds();
  check('the test sound button plays the "check" sound', s.length === s0 + 1 && s[s.length - 1] === 'check', s.slice(s0).join());
  await page.$eval('input[name="sound"]', (e) => e.scrollIntoView({ block: 'center' })); await sleep(100);
  await page.$eval('input[name="sound"]', (e) => e.click()); await sleep(200);
  const muted = await page.evaluate(() => JSON.parse(localStorage.getItem('ornate-chess:settings') || '{}').sound);
  const s1 = (await sounds()).length;
  await page.evaluate(async () => (await import(new URL('src/ui/sound.js', location.href).href)).play('move'));
  await sleep(100);
  check('with sound turned off, nothing plays', muted === false && (await sounds()).length === s1, String(muted));
  await page.$eval('input[name="sound"]', (e) => e.click()); await sleep(200);
  const s2 = await sounds();
  check('turning sound back on plays a confirmation sound', s2.length === s1 + 1);
});

check('no page errors', problems.length === 0, problems.join(' | '));
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} GUI sound checks passed.`);
process.exit(failed ? 1 : 0);
