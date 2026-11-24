// Tests for preloading the Brilliant sound (src/ui/sound.js, preloadSound and
// the play() fallback) and the sliced renderer in src/ui/brilliant-sound.js.
// The Brilliant chime is too slow to synthesise inside a tap on a slow phone,
// so it must be rendered in short idle slices, never inside play(), and a step
// that lands before it is ready must play the move's normal sound instead.
// Run: node tests/sound-preload.test.mjs
import assert from 'node:assert/strict';

let inGesture = false;
let rate = 48000;
const created = [];
class FakeNode { connect(n) { return n || this; } }
class FakeAudioContext {
  constructor() { this.state = 'suspended'; this.sampleRate = rate; this.currentTime = 0; this.destination = new FakeNode(); this.played = []; this.onstatechange = null; this.listeners = []; created.push(this); this.timer = setInterval(() => { if (this.state === 'running') this.currentTime += 0.01; }, 10); this.timer.unref(); }
  addEventListener(t, fn) { if (t === 'statechange') this.listeners.push(fn); }
  removeEventListener(t, fn) { this.listeners = this.listeners.filter((f) => f !== fn); }
  setState(s) { this.state = s; this.listeners.forEach((fn) => fn()); if (this.onstatechange) this.onstatechange(); }
  resume() { if (inGesture) { this.setState('running'); return Promise.resolve(); } return Promise.reject(new Error('NotAllowedError')); }
  close() { this.setState('closed'); return Promise.resolve(); }
  createBuffer(ch, len, sr) { const data = new Float32Array(len); return { length: len, sampleRate: sr, duration: len / sr, getChannelData: () => data }; }
  createBufferSource() { const c = this; const n = Object.assign(new FakeNode(), { buffer: null, start() { if (n.buffer && n.buffer.length > 1) c.played.push(n.buffer); }, stop() {} }); return n; }
  createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
}
const listeners = {};
const add = (target) => (type, fn) => { (listeners[target + ':' + type] ||= []).push(fn); };
globalThis.window = { AudioContext: FakeAudioContext, addEventListener: add('window') };
globalThis.document = { visibilityState: 'visible', addEventListener: add('document') };
Object.defineProperty(globalThis, 'navigator', { value: { userActivation: { get isActive() { return inGesture; } } }, configurable: true });
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const gesture = () => { inGesture = true; (listeners['window:touchend'] || []).forEach((fn) => fn({})); inGesture = false; };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const ok = (name, cond, detail = '') => { assert.ok(cond, name + (detail ? ' - ' + detail : '')); passed++; console.log('PASS ' + name); };

// --- The sliced renderer ----------------------------------------------------
const { synthBrilliant, createBrilliantRenderer, BRILLIANT_DURATION } = await import('../src/ui/brilliant-sound.js');
for (const sr of [44100, 48000]) {
  const whole = synthBrilliant(sr);
  for (const chunk of [1, 257, 4096]) {
    const r = createBrilliantRenderer(sr);
    let calls = 0;
    while (!r.step(chunk)) calls++;
    ok(`rendering in ${chunk}-sample slices at ${sr} Hz gives exactly the same samples`, r.data.length === whole.length && r.data.every((v, i) => v === whole[i]) && calls > 1);
  }
}
const syncMs = (() => { const t = performance.now(); synthBrilliant(48000); return performance.now() - t; })();

// --- Instance A: preload before any audio context exists ---------------------
const A = await import('../src/ui/sound.js?a');
ok('the Brilliant sound is not ready before anything preloads it', A.soundReady('brilliant') === false);
const pre = A.preloadSound('brilliant');
ok('preloadSound returns at once with a promise', pre && typeof pre.then === 'function' && A.audioState().slices === 0);
ok('preloading does not create an audio context', created.length === 0 && A.audioState().hasContext === false);
ok('the preload resolves once the sound is rendered', (await pre) === true && A.soundReady('brilliant'));
let st = A.audioState();
ok('the preload ran in several short slices, none a long task', st.slices > 1 && st.maxSliceMs < 12, `slices ${st.slices}, max ${st.maxSliceMs.toFixed(2)} ms (whole render ${syncMs.toFixed(1)} ms)`);
ok('preloading again reuses the finished sound', (await A.preloadSound('brilliant')) === true && A.audioState().slices === st.slices);
ok('preloading a cheap sound is a no-op that reports it is available', (await A.preloadSound('move')) === true);

gesture(); await tick(60);
const ca = created[created.length - 1];
ok('a tap unlocks the context', ca && ca.state === 'running');
let n0 = ca.played.length;
A.play('brilliant', { fallback: 'capture' });
ok('after the preload, the first Brilliant step plays the Brilliant sound itself', ca.played.length === n0 + 1 && Math.abs(ca.played[n0].duration - BRILLIANT_DURATION) < 0.01 && A.audioState().fallbacks === 0);
const slicesBefore = A.audioState().slices;
// iOS can leave a context "running" with a frozen clock. The next tap replaces
// it, and the new context must reuse the rendered samples, not render again.
clearInterval(ca.timer); A.play('move'); await tick(520);
gesture(); await tick(60);
const live = created.filter((c) => c.state !== 'closed');
ok('a frozen context is replaced on the next tap and closed (no leaked contexts)', A.audioState().recreated === 1 && ca.state === 'closed' && live.length === 1 && live[0] !== ca, `recreated ${A.audioState().recreated}, live ${live.length}`);
ok('the closed context no longer has the module listener attached', ca.listeners.length === 0 && ca.onstatechange === null);
const cl = live[0];
n0 = cl.played.length;
A.play('brilliant', { fallback: 'capture' });
ok('on the replacement context the Brilliant sound plays at once without rendering again', cl.played.length === n0 + 1 && Math.abs(cl.played[n0].duration - BRILLIANT_DURATION) < 0.01 && A.audioState().slices === slicesBefore && A.audioState().fallbacks === 0);
A.setSoundEnabled(false);
for (const c of created) if (c.timer) clearInterval(c.timer);

// --- Instance B: a step lands before the sound is ready ----------------------
rate = 44100;
const B = await import('../src/ui/sound.js?b');
const firstB = created.length;
gesture(); // B creates its own context and starts its idle prewarm
const cb = created.slice(firstB).find((c) => c.state === 'running');
ok('a second module instance unlocks its own context', !!cb);
ok('right after the context is created the Brilliant sound is still rendering', B.soundReady('brilliant') === false);
n0 = cb.played.length;
const t0 = performance.now();
const started = B.play('brilliant', { fallback: 'capture' });
const playMs = performance.now() - t0;
const capLen = B.synthesize('capture', 44100).length;
ok('a step before it is ready plays the fallback (the move\'s normal sound) at once', started === true && cb.played.length === n0 + 1 && cb.played[n0].length === capLen && B.audioState().fallbacks === 1);
ok('play() never renders the Brilliant sound itself', B.soundReady('brilliant') === false && playMs < Math.max(4, syncMs / 2), `play took ${playMs.toFixed(2)} ms, a full render takes ${syncMs.toFixed(1)} ms`);
n0 = cb.played.length;
ok('without a fallback, a not-ready Brilliant sound is skipped rather than rendered', B.play('brilliant') === false && cb.played.length === n0);
await B.preloadSound('brilliant');
st = B.audioState();
ok('the background render finishes in short slices', B.soundReady('brilliant') && st.maxSliceMs < 12, `max ${st.maxSliceMs.toFixed(2)} ms`);
n0 = cb.played.length;
B.play('brilliant', { fallback: 'capture' });
ok('once ready, the next Brilliant step plays the Brilliant sound at the context rate', cb.played.length === n0 + 1 && cb.played[n0].sampleRate === 44100 && Math.abs(cb.played[n0].duration - BRILLIANT_DURATION) < 0.01 && B.audioState().fallbacks === 1);
ok('the preloaded buffer has the same length as synthesize()', cb.played[n0].length === B.synthesize('brilliant', 44100).length);

// A Brilliant request on a locked context is queued with its fallback.
const cq = cb; cq.setState('suspended'); n0 = cq.played.length;
const rate2 = B.audioState().fallbacks;
B.play('brilliant', { fallback: 'capture' });
ok('a request on a suspended context is queued, not played', cq.played.length === n0 && B.audioState().pending === 'brilliant');
gesture(); await tick(40);
ok('the queued Brilliant request plays when the next tap resumes the context', cq.state === 'running' && cq.played.length === n0 + 1 && Math.abs(cq.played[n0].duration - BRILLIANT_DURATION) < 0.01 && B.audioState().fallbacks === rate2);
B.setSoundEnabled(false);
for (const c of created) if (c.timer) clearInterval(c.timer);

console.log(`\n${passed}/${passed} sound preload checks passed.`);
process.exit(0);
