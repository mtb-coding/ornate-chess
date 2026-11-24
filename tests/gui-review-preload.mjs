// GUI test for preloading the Brilliant sound, on an emulated phone at 6x CPU
// throttling. Opening the review page must render the Brilliant sound in short
// idle slices (no long task, no audio context needed), and the first step onto
// a Brilliant move must then cost no more than a normal step and play the
// Brilliant sound. AudioContext is the same recording fake as in
// gui-review-sound.mjs.
// Run: node tests/gui-review-preload.mjs
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
const cdp = await page.target().createCDPSession();
const THROTTLE = 6;
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await page.evaluate((id) => { location.hash = '#/review/' + encodeURIComponent(id); }, GAME.id);
await page.waitForFunction(() => window.__chess.page === 'review' && document.querySelector('.review-movelist [data-ply]'), { timeout: 30000 });

const S = () => page.evaluate(async () => { const m = await import('./src/ui/sound.js'); return { ready: m.soundReady('brilliant'), ...m.audioState() }; });
await page.waitForFunction(async () => (await import('./src/ui/sound.js')).soundReady('brilliant'), { timeout: 20000, polling: 100 });
let st = await S();
check('opening the review page preloads the Brilliant sound before any tap', st.ready && !st.hasContext, JSON.stringify({ ready: st.ready, hasContext: st.hasContext }));
check(`the preload ran in short slices at ${THROTTLE}x throttling, none near a long task`, st.slices > 1 && st.maxSliceMs < 25, `slices ${st.slices}, longest ${st.maxSliceMs.toFixed(1)} ms`);

const log = () => page.evaluate(() => window.__soundLog.map((e) => e.dur));
const tap = async (sel) => { const el = await page.$(sel); await el.scrollIntoView(); await el.tap(); await sleep(150); };
const isBrilliant = (d) => Math.abs(d - BRILLIANT_DURATION) < 0.02;
await tap('[data-act="first"]'); // unlocks audio
await sleep(1500); // let the context's own idle prewarm finish
// Time the synchronous work of each Next click (render + sound) at 6x.
const timeNext = () => page.evaluate(() => { const b = document.querySelector('[data-act="next"]'); const t = performance.now(); b.click(); return performance.now() - t; });
const times = [];
for (let ply = 1; ply <= B; ply++) { times.push({ ply, ms: await timeNext() }); await sleep(120); }
const l = await log();
const normal = times.filter((t) => t.ply !== B && t.ply > 1).map((t) => t.ms);
const onB = times.find((t) => t.ply === B).ms;
const worstNormal = Math.max(...normal);
check('the first step onto the Brilliant move plays the Brilliant sound', isBrilliant(l[l.length - 1]), JSON.stringify(l.slice(-3)));
check('the first Brilliant step costs no more than a normal step (no render inside it)', onB < worstNormal + 25, `Brilliant ${onB.toFixed(1)} ms, normal steps ${normal.map((x) => x.toFixed(1)).join(', ')} ms`);
st = await S();
check('no step used the fallback sound', st.fallbacks === 0, String(st.fallbacks));
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

check('no page errors', problems.length === 0, problems.join(' | '));
console.log(`\nReview preload GUI tests: ${pass} passed, ${fail} failed`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
