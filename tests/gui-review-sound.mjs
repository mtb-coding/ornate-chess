// GUI test for the Game Review sounds on an emulated phone. AudioContext is
// replaced by a recording fake that, like iOS Safari, starts suspended and
// only resumes while a trusted gesture is being handled. Checks that stepping
// onto a Brilliant move (forward, by jumping from the move list, and with the
// keyboard) starts the Brilliant buffer, that other moves start their normal
// sound, that a step back is silent, and that the sound setting mutes it.
// Run: node tests/gui-review-sound.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './gui-static-server.mjs';
import { START_FEN } from '../src/engine.js';
import { buildReview, reviewFingerprint, REVIEW_DEPTH } from '../src/review.js';
import { createReviewStore } from '../src/review-storage.js';
import { MemoryStorage } from '../src/storage.js';
import { BRILLIANT_DURATION } from '../src/ui/brilliant-sound.js';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER || '/workspace/.ptools/node_modules/puppeteer-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

// Real review of the Italian fixture, with one move relabelled Brilliant so
// the UI path can be exercised (the label is what triggers the sound).
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/italian-review-evals.json'), 'utf8')).games.castleMiss;
const REVIEW = buildReview({ startFen: START_FEN, uci: FX.uci, mode: 'local', depth: REVIEW_DEPTH, name: 'Sound test game', evals: FX.evals });
REVIEW.analyzedAt = 1700000000000;
const B = 5; // ply of the Brilliant move (3.Bc4)
REVIEW.moves[B - 1].judgment = 'brilliant';
const GREAT = 3;
REVIEW.moves[GREAT - 1].judgment = 'great';
const FP = reviewFingerprint(START_FEN, FX.uci, REVIEW_DEPTH);
const mem = new MemoryStorage();
createReviewStore({ backend: mem }).saveReview(REVIEW);
const GAME = { id: 'gui-sound-game', name: 'Sound test game', savedAt: 1700000000000, mode: 'local', game: { version: 1, startFen: START_FEN, uci: FX.uci, resultInfo: { result: '1-0', reason: 'resignation' } } };

const FAKE = () => {
  let inGesture = false;
  for (const t of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown']) {
    window.addEventListener(t, (e) => { if (e.isTrusted) { inGesture = true; setTimeout(() => { inGesture = false; }, 0); } }, { capture: true });
  }
  const log = [];
  class N { connect(n) { return n || this; } disconnect() {} }
  class P { constructor() { this.value = 1; } setValueAtTime() {} exponentialRampToValueAtTime() {} linearRampToValueAtTime() {} }
  class FakeAC extends EventTarget {
    constructor() { super(); this.state = 'suspended'; this.sampleRate = 48000; this.t0 = performance.now(); this.destination = new N(); this.onstatechange = null; }
    get currentTime() { return this.state === 'running' ? (performance.now() - this.t0) / 1000 : 0; }
    set(s) { this.state = s; const ev = new Event('statechange'); this.dispatchEvent(ev); if (this.onstatechange) this.onstatechange(ev); }
    resume() { if (inGesture) { this.set('running'); return Promise.resolve(); } return new Promise(() => {}); }
    suspend() { this.set('suspended'); return Promise.resolve(); }
    close() { this.set('closed'); return Promise.resolve(); }
    createBuffer(ch, len, sr) { const d = new Float32Array(len); return { length: len, sampleRate: sr, duration: len / sr, getChannelData: () => d }; }
    createBufferSource() { const c = this; const n = new N(); Object.assign(n, { buffer: null, onended: null, start() { if (c.state === 'running' && n.buffer && n.buffer.length > 1) log.push({ dur: n.buffer.duration, at: performance.now() }); }, stop() {} }); return n; }
    createGain() { const n = new N(); n.gain = new P(); return n; }
    createDynamicsCompressor() { const n = new N(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new P(); return n; }
    createBiquadFilter() { const n = new N(); n.frequency = new P(); n.Q = new P(); return n; }
    createOscillator() { const n = new N(); n.frequency = new P(); n.start = () => {}; n.stop = () => {}; return n; }
  }
  window.AudioContext = FakeAC; window.webkitAudioContext = FakeAC;
  window.__soundLog = log;
};

const server = await startServer(0);
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
await page.evaluateOnNewDocument(FAKE);
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = () => page.waitForFunction(() => window.__chess && window.__chess.ready, { timeout: 30000 });

await page.goto(BASE, { waitUntil: 'load' }); await ready();
await page.evaluate(({ index, key, json, game }) => {
  localStorage.clear();
  localStorage.setItem('ornate-chess:reviews-index', index);
  localStorage.setItem(key, json);
  localStorage.setItem('ornate-chess:games', JSON.stringify([game]));
}, { index: mem.getItem('ornate-chess:reviews-index'), key: `ornate-chess:review:${FP}`, json: mem.getItem(`ornate-chess:review:${FP}`), game: GAME });
await page.reload({ waitUntil: 'load' }); await ready();
await page.evaluate((id) => { location.hash = '#/review/' + encodeURIComponent(id); }, GAME.id);
await page.waitForFunction(() => window.__chess.page === 'review' && document.querySelector('.review-movelist [data-ply]'), { timeout: 30000 });
await sleep(400);

const log = () => page.evaluate(() => window.__soundLog.map((e) => e.dur));
const tap = async (sel) => { const el = await page.$(sel); await el.scrollIntoView(); await el.tap(); await sleep(120); };
const isBrilliant = (d) => Math.abs(d - BRILLIANT_DURATION) < 0.02;

await tap('[data-act="first"]');
check('the first tap unlocks audio without a sound at the start position', (await log()).length === 0);
const stepped = [];
for (let ply = 1; ply <= B + 1; ply++) {
  const before = (await log()).length;
  await tap('[data-act="next"]');
  const after = await log();
  stepped.push({ ply, n: after.length - before, dur: after[after.length - 1] });
}
const onB = stepped.find((s) => s.ply === B);
check('stepping forward onto the Brilliant move starts the Brilliant sound', onB && onB.n === 1 && isBrilliant(onB.dur), JSON.stringify(onB));
check('every other forward step starts its normal move sound', stepped.filter((s) => s.ply !== B).every((s) => s.n === 1 && !isBrilliant(s.dur)), JSON.stringify(stepped));
const onGreat = stepped.find((s) => s.ply === GREAT);
check('a Great move keeps the normal sound', onGreat && !isBrilliant(onGreat.dur));

let n0 = (await log()).length;
await tap('[data-act="prev"]');
check('one step back onto the Brilliant move is silent', (await log()).length === n0 && await page.evaluate(() => window.__chess.reviewPly) === B);

await tap('[data-act="last"]');
n0 = (await log()).length;
await tap(`.review-movelist [data-ply="${B}"]`);
let l = await log();
check('jumping to the Brilliant move from the move list plays the Brilliant sound', l.length === n0 + 1 && isBrilliant(l[l.length - 1]));

await tap('[data-act="first"]');
for (let i = 0; i < B - 1; i++) await tap('[data-act="next"]');
n0 = (await log()).length;
await page.keyboard.press('ArrowRight'); await sleep(150);
l = await log();
check('the arrow key onto the Brilliant move plays the Brilliant sound', l.length === n0 + 1 && isBrilliant(l[l.length - 1]));

// Rapid stepping: each step starts its own sound.
await tap('[data-act="first"]');
n0 = (await log()).length;
const btn = await page.$('[data-act="next"]');
for (let i = 0; i < 8; i++) await btn.tap();
await sleep(200);
check('eight rapid taps on Next start eight sounds', (await log()).length === n0 + 8, `${(await log()).length - n0}`);

// Mute through the real settings page.
await page.evaluate(() => { location.hash = '#/settings'; });
await page.waitForFunction(() => window.__chess.page === 'settings', { timeout: 30000 }); await sleep(300);
await tap('input[name="sound"]');
const soundOn = await page.$eval('input[name="sound"]', (e) => e.checked);
await page.evaluate((id) => { location.hash = '#/review/' + encodeURIComponent(id); }, GAME.id);
await page.waitForFunction(() => window.__chess.page === 'review' && document.querySelector('.review-movelist [data-ply]'), { timeout: 30000 }); await sleep(300);
n0 = (await log()).length;
await tap(`.review-movelist [data-ply="${B}"]`);
await tap('[data-act="next"]');
check('with sound turned off, review steps are silent', !soundOn && (await log()).length === n0);

check('no page errors', problems.length === 0, problems.join(' | '));
console.log(`\nReview sound GUI tests: ${pass} passed, ${fail} failed`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
