// Tests for the Game Review sounds: the Brilliant sound (src/ui/brilliant-sound.js),
// its registration in src/ui/sound.js, and the step logic in src/ui/review-sound.js.
// A fake AudioContext that behaves like iOS Safari (suspended until a gesture)
// stands in for WebAudio.
// Run: node tests/review-sound.test.mjs
import assert from 'node:assert/strict';

let inGesture = false;
const created = [];
class FakeNode { connect(n) { return n || this; } }
class FakeParam { setValueAtTime() {} exponentialRampToValueAtTime() {} set value(v) { this.v = v; } get value() { return this.v; } }
class FakeAudioContext {
  constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.currentTime = 0; this.destination = new FakeNode(); this.played = []; this.buffers = 0; this.onstatechange = null; created.push(this); this.timer = setInterval(() => { if (this.state === 'running') this.currentTime += 0.01; }, 10); this.timer.unref(); }
  addEventListener(t, fn) { if (t === 'statechange') this.onstatechange = fn; }
  setState(s) { this.state = s; if (this.onstatechange) this.onstatechange(); }
  resume() { if (inGesture) { this.setState('running'); return Promise.resolve(); } return Promise.reject(new Error('NotAllowedError')); }
  close() { this.setState('closed'); return Promise.resolve(); }
  createBuffer(ch, len) { this.buffers++; const data = new Float32Array(len); return { length: len, duration: len / this.sampleRate, getChannelData: () => data }; }
  createBufferSource() { const c = this; const n = Object.assign(new FakeNode(), { buffer: null, start() { c.played.push(n.buffer); }, stop() {} }); return n; }
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createDynamicsCompressor() { return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() }); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() }); }
  createOscillator() { return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), start() {}, stop() {} }); }
}
const listeners = {};
const add = (target) => (type, fn) => { (listeners[target + ':' + type] ||= []).push(fn); };
globalThis.window = { AudioContext: FakeAudioContext, addEventListener: add('window') };
globalThis.document = { visibilityState: 'visible', addEventListener: add('document') };
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const fire = (key) => (listeners[key] || []).forEach((fn) => fn({}));
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const { synthBrilliant, BRILLIANT_DURATION } = await import('../src/ui/brilliant-sound.js');
const sound = await import('../src/ui/sound.js');
const rs = await import('../src/ui/review-sound.js');
const state = await import('../src/ui/state.js');

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log('PASS ' + name); };

// The synthesised sound.
const wave = synthBrilliant(48000);
let peak = 0; for (const v of wave) peak = Math.max(peak, Math.abs(v));
ok('the Brilliant sound is shorter than one second', wave.length / 48000 < 1 && BRILLIANT_DURATION < 1);
ok('the Brilliant sound peaks well below full scale', peak > 0.3 && peak <= 0.56);
ok('the Brilliant sound ends in silence', Math.abs(wave[wave.length - 1]) < 1e-3);
ok('the Brilliant sound starts immediately (the knock is in the first 5 ms)', wave.slice(0, 240).some((v) => Math.abs(v) > 0.05));
ok('the Brilliant sound is deterministic', synthBrilliant(48000).every((v, i) => v === wave[i]));
ok('the Brilliant sound renders at 44.1 kHz too', synthBrilliant(44100).length === Math.ceil(44100 * BRILLIANT_DURATION));

// Registration in sound.js.
ok("'brilliant' is a known sound kind", sound.SOUND_KINDS.includes('brilliant'));
if (typeof sound.synthesize === 'function') {
  const s = sound.synthesize('brilliant', 48000);
  ok("sound.js renders 'brilliant' from brilliant-sound.js", s && s.length >= wave.length && Math.abs(s[1000] - wave[1000]) < 1e-6);
}

// SAN sound choice.
ok('soundForSan picks check, promote, castle, capture and move',
  rs.soundForSan('Qxf7#') === 'check' && rs.soundForSan('e8=Q') === 'promote' && rs.soundForSan('O-O-O') === 'castle'
  && rs.soundForSan('Nxg5') === 'capture' && rs.soundForSan('Nf3') === 'move');

// Step logic.
const review = {
  sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bxf7+', 'Kxf7', 'O-O'],
  moves: ['book', 'book', 'best', 'great', 'brilliant', 'best', 'excellent'].map((judgment) => ({ judgment })),
};
ok('stepping forward onto a Brilliant move picks the Brilliant sound', rs.reviewSoundKind(review, 4, 5) === 'brilliant');
ok('jumping to a Brilliant move (move list, graph, from either side) picks the Brilliant sound', rs.reviewSoundKind(review, 0, 5) === 'brilliant' && rs.reviewSoundKind(review, 7, 5) === 'brilliant');
ok('a Great move keeps the normal move sound', rs.reviewSoundKind(review, 3, 4) === 'move');
ok('a Best capture keeps the capture sound', rs.reviewSoundKind(review, 5, 6) === 'capture');
ok('castling plays the castle sound', rs.reviewSoundKind(review, 6, 7) === 'castle');
ok('jumping to the last move plays its sound', rs.reviewSoundKind(review, 0, 7) === 'castle');
ok('one step back is silent, even onto a Brilliant move', rs.reviewSoundKind(review, 6, 5) === null);
ok('the start position and an unchanged ply are silent', rs.reviewSoundKind(review, 3, 0) === null && rs.reviewSoundKind(review, 5, 5) === null);

// End to end through sound.js with the mocked context.
state.app.settings = { sound: true };
sound.setSoundEnabled(true);
inGesture = true; fire('window:touchend'); inGesture = false; await tick(60);
const c = created[created.length - 1];
ok('a tap unlocks the shared context', c && c.state === 'running');
ok('preloadReviewSounds renders the Brilliant sound in the background', (await rs.preloadReviewSounds()) === true && sound.soundReady('brilliant'));
let n0 = c.played.length;
ok('playReviewStep returns brilliant for a Brilliant step', rs.playReviewStep(review, 4, 5) === 'brilliant');
await tick();
const brilliantBuf = c.played[c.played.length - 1];
ok('a Brilliant step starts one buffer of about 0.8 s', c.played.length === n0 + 1 && brilliantBuf && Math.abs(brilliantBuf.length / 48000 - BRILLIANT_DURATION) < 0.02);
n0 = c.played.length;
rs.playReviewStep(review, 3, 4); await tick();
const moveBuf = c.played[c.played.length - 1];
ok('a Great step plays the normal move sound, not the Brilliant one', c.played.length === n0 + 1 && moveBuf !== brilliantBuf && moveBuf.length < brilliantBuf.length);
n0 = c.played.length;
for (let i = 1; i <= 7; i++) rs.playReviewStep(review, i - 1, i);
await tick();
ok('rapid forward steps through the whole game each start a sound', c.played.length === n0 + 7);
n0 = c.played.length;
rs.playReviewStep(review, 2, 5); rs.playReviewStep(review, 2, 5); await tick();
ok('two Brilliant sounds in a row both play and reuse one buffer', c.played.length === n0 + 2 && c.played[n0] === c.played[n0 + 1]);

// Mute setting.
state.app.settings = { sound: false };
n0 = c.played.length;
ok('with sound turned off, a Brilliant step plays nothing', rs.playReviewStep(review, 4, 5) === null);
await tick();
ok('nothing was started while muted', c.played.length === n0);
state.app.settings = { sound: true };
sound.setSoundEnabled(false); n0 = c.played.length; rs.playReviewStep(review, 4, 5); await tick();
ok('the global sound switch in sound.js also silences the Brilliant sound', c.played.length === n0);
sound.setSoundEnabled(true);

// Suspended after backgrounding: the next tap brings the Brilliant sound back.
c.setState('interrupted');
document.visibilityState = 'visible';
inGesture = true; fire('window:touchend'); inGesture = false; await tick(60);
const live = created[created.length - 1];
n0 = live.played.length;
rs.playReviewStep(review, 4, 5); await tick();
ok('after an interruption and a tap, the Brilliant sound plays again', live.state === 'running' && live.played.length === n0 + 1);

console.log(`\n${passed}/${passed} review sound checks passed.`);
process.exit(0);
