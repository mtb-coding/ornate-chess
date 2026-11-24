// Unit test for src/ui/sound.js with a fake AudioContext that behaves like the
// mobile browsers: it starts suspended, resume() only succeeds inside a user
// gesture, iOS can interrupt it, wedge it so resume() fails, or leave it
// "running" with a frozen clock. Bot moves arrive from timers with no gesture.
// Run: node tests/sound.test.mjs
import assert from 'node:assert/strict';

let inGesture = false;
let resumeOutsideGesture = false; // Chrome: allowed once the page has had activation
let wedged = false;                // iOS after an interruption: resume() fails
const created = [];
const wall = () => performance.now();
class FakeNode { connect(n) { return n || this; } }
class FakeAudioContext {
  constructor() {
    this.state = 'suspended'; this.sampleRate = 44100; this.destination = new FakeNode();
    this.starts = []; this.stops = 0; this.buffers = []; this.listeners = []; this.onstatechange = null;
    this.clock = 0; this.runSince = null; this.frozen = false;
    created.push(this);
  }
  get currentTime() { return this.clock + (this.state === 'running' && !this.frozen && this.runSince != null ? (wall() - this.runSince) / 1000 : 0); }
  setState(s) {
    if (this.state === 'running' && this.runSince != null) { this.clock += (wall() - this.runSince) / 1000; }
    this.runSince = s === 'running' ? wall() : null;
    this.state = s;
    for (const fn of this.listeners) fn();
    if (this.onstatechange) this.onstatechange();
  }
  addEventListener(t, fn) { if (t === 'statechange') this.listeners.push(fn); }
  resume() {
    if (this.state === 'closed') return Promise.reject(new Error('InvalidStateError'));
    if (!wedged && (inGesture || resumeOutsideGesture)) { this.setState('running'); return Promise.resolve(); }
    return Promise.reject(new Error('NotAllowedError'));
  }
  close() { this.setState('closed'); return Promise.resolve(); }
  createBuffer(ch, len) { this.buffers.push(len); const data = new Float32Array(len); return { length: len, getChannelData: () => data }; }
  createBufferSource() {
    const c = this;
    return Object.assign(new FakeNode(), { buffer: null, onended: null, start() { c.starts.push(this.buffer ? this.buffer.length : 0); }, stop() { c.stops++; } });
  }
  createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
}

const listeners = {};
const add = (target) => (type, fn) => { (listeners[target + ':' + type] ||= []).push(fn); };
globalThis.window = { AudioContext: FakeAudioContext, addEventListener: add('window') };
globalThis.document = { visibilityState: 'visible', addEventListener: add('document') };
Object.defineProperty(globalThis, 'navigator', { value: { userActivation: { get isActive() { return inGesture; } } }, configurable: true });
const fire = (key) => (listeners[key] || []).forEach((fn) => fn({}));
const gesture = (type = 'touchend') => { inGesture = true; fire('window:' + type); inGesture = false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(20);

const sound = await import('../src/ui/sound.js');
const LEN = Object.fromEntries(sound.SOUND_KINDS.map((k) => [sound.synthesize(k, 44100).length, k]));
const audible = (c) => c.starts.filter((n) => n > 1).map((n) => LEN[n] || '?');
const live = () => created.filter((x) => x.state !== 'closed');
const cur = () => live()[live().length - 1];

let passed = 0;
const ok = (name, cond, detail = '') => { assert.ok(cond, name + (detail ? ' - ' + detail : '')); passed++; console.log('PASS ' + name); };

// --- Setup ---------------------------------------------------------------
ok('gesture listeners are installed for touch, pointer, mouse, click and key events',
  ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown'].every((t) => listeners['window:' + t]));
ok('visibilitychange, pageshow and focus listeners are installed',
  !!listeners['document:visibilitychange'] && !!listeners['window:pageshow'] && !!listeners['window:focus']);
ok('no context is created before a sound or a gesture', created.length === 0);

ok('every sound has a distinct length so the fake can name it', Object.keys(LEN).length === sound.SOUND_KINDS.length);
for (const k of sound.SOUND_KINDS) {
  const d = sound.synthesize(k, 44100);
  let peak = 0; for (const v of d) peak = Math.max(peak, Math.abs(v));
  ok(`the "${k}" sound renders to an audible, unclipped buffer`, peak > 0.02 && peak <= 1, String(peak));
}
ok('unknown sound names are ignored', sound.play('nonsense') === false && created.length === 0);

// --- Locked context: a bot move before any tap ----------------------------
ok('a sound before the first gesture is not started on a locked context', sound.play('move') === false);
sound.play('capture'); await tick();
ok('sounds before the first gesture share one context', created.length === 1);
ok('nothing audible is scheduled while the context is locked', audible(created[0]).length === 0);
ok('only the newest locked sound is kept', sound.audioState().pending === 'capture');

// The first tap unlocks the context and plays the waiting sound (it is fresh).
gesture('touchend'); await tick();
const c = created[0];
ok('the first touchend resumes the context', c.state === 'running');
ok('the first gesture plays a one-sample silent unlock buffer', c.starts.includes(1));
ok('the fresh pending sound plays as soon as the context runs', audible(c).join() === 'capture', audible(c).join());

// --- Unlocked: bot moves from timers, rapid moves --------------------------
let n0 = audible(c).length;
await new Promise((r) => setTimeout(() => { sound.play('move'); r(); }, 5));
ok('a bot move from a timer callback plays on the unlocked context', audible(c).length === n0 + 1);

n0 = audible(c).length; const stops0 = c.stops;
for (let i = 0; i < 6; i++) sound.play(i % 2 ? 'capture' : 'move');
ok('six rapid moves start six sounds', audible(c).length === n0 + 6);
ok('rapid moves do not cut each other off', c.stops === stops0);
for (let i = 0; i < 6; i++) sound.play('move');
ok('voices are capped so a flood of sounds cannot pile up', sound.audioState().voices <= 8 && c.stops > stops0);

await sleep(400); // let the idle prewarm finish
const bufCount = c.buffers.filter((n) => n > 1).length;
for (const k of sound.SOUND_KINDS) sound.play(k);
for (const k of sound.SOUND_KINDS) sound.play(k);
ok('every sound buffer is rendered once per context and reused', c.buffers.filter((n) => n > 1).length === bufCount && bufCount === sound.SOUND_KINDS.length, `${bufCount}`);

// --- Every move type maps to a sound and plays -----------------------------
const pos = (check) => ({ inCheck: () => check });
const cases = [
  [{ flags: 'n' }, pos(false), 'move'], [{ flags: 'c', captured: 'p' }, pos(false), 'capture'], [{ flags: 'e', captured: 'p' }, pos(false), 'capture'],
  [{ flags: 'k' }, pos(false), 'castle'], [{ flags: 'q' }, pos(false), 'castle'], [{ flags: 'np', promotion: 'q' }, pos(false), 'promote'],
  [{ flags: 'cp', promotion: 'n', captured: 'r' }, pos(false), 'promote'], [{ flags: 'n' }, pos(true), 'check'], [{ flags: 'c', captured: 'q' }, pos(true), 'check'],
];
for (const [mv, p, want] of cases) {
  const kind = sound.soundForMove(mv, p);
  const before = audible(c).length;
  sound.play(kind);
  ok(`a ${JSON.stringify(mv)}${p.inCheck() ? ' giving check' : ''} move plays "${want}"`, kind === want && audible(c).slice(before).join() === want);
}

// --- iOS interruption (call, Siri, lock screen) -----------------------------
c.setState('interrupted');
n0 = audible(c).length;
ok('a move while interrupted is not started on the dead output', sound.play('move') === false && audible(c).length === n0);
c.setState('running'); await tick(); // iOS resumes by itself when the interruption ends
ok('the queued sound plays when the interruption ends', audible(c).length === n0 + 1);

c.setState('interrupted');
resumeOutsideGesture = true; document.visibilityState = 'visible'; fire('document:visibilitychange'); resumeOutsideGesture = false; await tick();
ok('visibilitychange resumes an interrupted context', c.state === 'running');
c.setState('suspended');
resumeOutsideGesture = true; fire('window:pageshow'); resumeOutsideGesture = false; await tick();
ok('pageshow resumes a suspended context', c.state === 'running');
document.visibilityState = 'hidden'; c.setState('suspended'); fire('document:visibilitychange'); await tick();
ok('a hidden page does not try to resume', c.state === 'suspended');
document.visibilityState = 'visible';

// Suspended, then the user taps: the tap resumes and the move's sound plays.
n0 = audible(c).length;
inGesture = true; fire('window:pointerdown'); sound.play('check'); inGesture = false; await sleep(30);
ok('a move made by a tap on a suspended context plays after resume()', c.state === 'running' && audible(c).length === n0 + 1);

// A stale sound is dropped instead of playing late.
c.setState('suspended'); n0 = audible(c).length;
sound.play('move'); await sleep(700);
gesture('touchend'); await tick();
ok('a sound older than the pending window is dropped, not played late', audible(c).length === n0 && c.state === 'running');

// --- Wedged context: resume() fails inside a gesture -----------------------
c.setState('interrupted'); wedged = true;
gesture('touchend'); await sleep(350);
ok('a failed resume inside a gesture marks the context as dead', sound.audioState().dead === true);
wedged = false;
sound.play('move'); // a bot move: queued for the replacement context
gesture('touchend'); await tick();
const c2 = cur();
ok('the next gesture replaces the dead context', c2 !== c && c.state === 'closed' && c2.state === 'running');
ok('only one live context exists at a time', live().length === 1);
ok('the queued move sound plays on the replacement context', audible(c2).join() === 'move', audible(c2).join());

// --- Frozen clock: iOS reports running but outputs nothing -----------------
await sleep(50);
c2.frozen = true; sound.play('move'); await sleep(500);
n0 = audible(c2).length;
ok('a running context whose clock stopped is detected', sound.play('capture') === false && sound.audioState().dead === true && audible(c2).length === n0);
gesture('pointerup'); await tick();
const c3 = cur();
ok('the next gesture replaces the frozen context and plays the waiting sound', c3 !== c2 && c3.state === 'running' && audible(c3).join() === 'capture', audible(c3).join());

// Coming back to the page with a frozen clock is caught as well.
await sleep(30); c3.frozen = true;
fire('document:visibilitychange'); await sleep(500);
ok('returning to a page whose context clock is frozen marks it dead', sound.audioState().dead === true);
gesture('keydown'); await tick();
ok('a key press replaces it', cur() !== c3 && cur().state === 'running');

// --- Closed context, mute -------------------------------------------------
cur().setState('closed'); const nCtx = created.length;
sound.play('move');
ok('a closed context is replaced by a new one', created.length === nCtx + 1 && live().length === 1);
gesture(); await tick();

const c5 = cur(); n0 = audible(c5).length;
sound.setSoundEnabled(false);
ok('nothing plays when sound is turned off', sound.play('move') === false && audible(c5).length === n0);
ok('turning sound off clears a pending sound', sound.audioState().pending === null);
sound.setSoundEnabled(true);
ok('sound plays again after it is turned back on', sound.play('move') === true && audible(c5).length === n0 + 1);

console.log(`\n${passed}/${passed} sound checks passed.`);
process.exit(0);
