// Sound effects for Ornate Chess. No audio files are used: every sound is
// synthesised once per audio context into an AudioBuffer, and each play is a
// single AudioBufferSourceNode started "now".
//
// Why the sounds are pre-rendered rather than built from oscillators on each
// play: a scheduled envelope (start at currentTime + 10 ms, fade out 30-90 ms
// later) is cut short or lost entirely when a busy phone delivers the request
// to the audio thread late. A pre-rendered buffer started without a time
// always plays from its first sample, whenever the audio thread picks it up.
//
// Mobile handling:
// - One shared AudioContext. It is unlocked on the first pointerdown,
//   pointerup, touchstart, touchend, mousedown, click or keydown by playing a
//   one-sample silent buffer and calling resume() inside that gesture.
//   Android Chrome only counts touchend / pointerup / click as activation, and
//   older iOS only touchend, so all of them are listened for.
// - The context is resumed on visibilitychange, pageshow and focus, and before
//   every play. iOS uses the extra 'interrupted' state after a call, Siri or
//   the screen lock; it is treated like 'suspended'.
// - A sound requested while the context is not running is kept for a short
//   time and played as soon as resume() succeeds. Only the newest one is kept,
//   and it is dropped if it is older than PENDING_MAX_MS, so returning to the
//   app never produces a burst of stale sounds.
// - iOS can leave a context reporting 'running' while its clock no longer
//   advances, and a resume() inside a gesture can fail after an interruption.
//   Both cases mark the context as dead, and the next gesture closes it and
//   creates a fresh one.
// - Overlapping sounds never cut each other off. At most MAX_VOICES play at
//   once; beyond that the oldest is stopped.
// - The iPhone ring/silent switch mutes WebAudio (Safari maps it to the
//   'ambient' audio session). That is a platform rule and is not overridden.

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
const GESTURES = ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown'];
import { synthBrilliant, createBrilliantRenderer, BRILLIANT_DURATION } from './brilliant-sound.js';

export const SOUND_KINDS = ['move', 'capture', 'castle', 'check', 'promote', 'illegal', 'end', 'correct', 'wrong', 'tick', 'brilliant'];
const VOLUME = 1;
const MAX_VOICES = 8;
const PENDING_MAX_MS = 600;
const RESUME_WAIT_MS = 300;
const STUCK_MS = 450;

let ctx = null;
let master = null;
let buffers = new Map();
let enabled = true;
let unlocked = false;
let dead = false;          // the context must be replaced on the next gesture
let pending = null;        // { kind, at }
let resuming = false;
let voices = [];
let clockSample = { ct: -1, wall: 0 };
let lastRate = 0;          // sample rate of the most recent context
const stats = { requested: 0, started: 0, queued: 0, dropped: 0, contexts: 0, recreated: 0, fallbacks: 0, slices: 0, maxSliceMs: 0 };

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export function setSoundEnabled(on) {
  enabled = !!on;
  if (!enabled) { pending = null; stopAll(); }
}

// ---------------------------------------------------------------------------
// Synthesis. These reproduce the original oscillator/noise sounds sample by
// sample (RBJ band-pass on decaying noise plus a falling sine body for the
// wooden knock, exponential-envelope partials for the bells).

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function knock(out, sr, at, { freq = 900, q = 3, gain = 0.5, body = 180, dur = 0.09 } = {}, seed = 1) {
  const off = Math.round(at * sr);
  const n = Math.max(1, Math.round(dur * sr));
  const rand = rng(seed);
  const w0 = 2 * Math.PI * Math.min(freq, sr * 0.45) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, phase = 0;
  const g2 = gain * 0.5;
  for (let i = 0; i < n && off + i < out.length; i++) {
    const p = i / n;
    const x = (rand() * 2 - 1) * Math.pow(1 - p, 3);
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const f = body * Math.pow(0.6, p);
    phase += 2 * Math.PI * f / sr;
    out[off + i] += y * gain * Math.pow(0.001 / gain, p) + Math.sin(phase) * g2 * Math.pow(0.001 / g2, p);
  }
}

function bell(out, sr, at, freqs, { gain = 0.12, dur = 0.6, type = 'sine' } = {}) {
  freqs.forEach((f, idx) => {
    const off = Math.round((at + idx * 0.09) * sr);
    const n = Math.round(dur * sr);
    const atk = Math.max(1, Math.round(0.01 * sr));
    let phase = 0;
    for (let i = 0; i < n && off + i < out.length; i++) {
      phase += 2 * Math.PI * f / sr;
      const w = type === 'triangle' ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
      const env = i < atk
        ? 0.0001 * Math.pow(gain / 0.0001, i / atk)
        : gain * Math.pow(0.0001 / gain, (i - atk) / Math.max(1, n - atk));
      out[off + i] += w * env;
    }
  });
}

// Each recipe lists its layers and its length in seconds.
const RECIPES = {
  move: { len: 0.11, draw: (o, sr) => knock(o, sr, 0, undefined, 11) },
  capture: { len: 0.16, draw: (o, sr) => { knock(o, sr, 0, { freq: 1400, gain: 0.6, body: 140, dur: 0.12 }, 21); knock(o, sr, 0.05, { freq: 700, gain: 0.3, dur: 0.07 }, 22); } },
  castle: { len: 0.22, draw: (o, sr) => { knock(o, sr, 0, undefined, 31); knock(o, sr, 0.11, { freq: 800 }, 32); } },
  check: { len: 0.48, draw: (o, sr) => { knock(o, sr, 0, undefined, 41); bell(o, sr, 0.02, [880, 1174.7], { gain: 0.08, dur: 0.35 }); } },
  promote: { len: 0.53, draw: (o, sr) => { knock(o, sr, 0, undefined, 51); bell(o, sr, 0.02, [659.3, 987.8], { gain: 0.08, dur: 0.4 }); } },
  illegal: { len: 0.2, draw: (o, sr) => bell(o, sr, 0, [196], { gain: 0.09, dur: 0.18, type: 'triangle' }) },
  end: { len: 1.39, draw: (o, sr) => bell(o, sr, 0, [523.3, 659.3, 784, 1046.5], { gain: 0.09, dur: 1.1 }) },
  correct: { len: 0.6, draw: (o, sr) => bell(o, sr, 0, [784, 1046.5], { gain: 0.09, dur: 0.5 }) },
  wrong: { len: 0.4, draw: (o, sr) => bell(o, sr, 0, [233, 196], { gain: 0.09, dur: 0.3, type: 'triangle' }) },
  tick: { len: 0.035, draw: (o, sr) => knock(o, sr, 0, { freq: 3000, gain: 0.08, body: 1200, dur: 0.03 }, 101) },
  // Game Review only: an original synthesised chime, see brilliant-sound.js.
  brilliant: { len: BRILLIANT_DURATION, draw: (o, sr) => { const d = synthBrilliant(sr); for (let i = 0; i < d.length && i < o.length; i++) o[i] += d[i]; } },
};

/** Renders one sound to raw samples. Exported for tests. */
export function synthesize(kind, sampleRate = 48000) {
  const r = RECIPES[kind];
  if (!r) return null;
  const out = new Float32Array(Math.ceil(r.len * sampleRate) + 1);
  r.draw(out, sampleRate);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

// Sounds that are too slow to synthesise inside a click handler on a slow
// phone (the Brilliant chime takes about 78 ms at 6x CPU throttling). They
// are never rendered synchronously: they are rendered in small slices during
// idle time, and a play() that arrives before they are ready uses the
// fallback sound passed by the caller.
const HEAVY = new Set(['brilliant']);
const SLICE_MS = 4;           // work budget per slice outside idle time
const SLICE_SAMPLES = 512;    // samples rendered between budget checks
// Finished samples, by kind and sample rate. They live outside the audio
// context, so replacing a dead context does not render them again.
const rendered = new Map();   // `${kind}@${sr}` -> Float32Array
const jobs = new Map();       // `${kind}@${sr}` -> { promise }

const idle = (fn) => (typeof requestIdleCallback === 'function'
  ? requestIdleCallback(fn, { timeout: 1000 })
  : setTimeout(() => fn(null), 16));

function heavySamples(kind, sr) {
  const exact = rendered.get(`${kind}@${sr}`);
  if (exact) return { data: exact, sr };
  // Samples at another rate still play: the browser resamples the buffer.
  for (const [key, data] of rendered) {
    const at = key.lastIndexOf('@');
    if (key.slice(0, at) === kind) return { data, sr: +key.slice(at + 1) };
  }
  return null;
}

// Renders a heavy sound in slices of at most SLICE_MS (or the idle deadline)
// each, so no slice is a long task. Resolves to true when the samples exist.
function renderHeavy(kind, sr) {
  const key = `${kind}@${sr}`;
  if (rendered.has(key)) return Promise.resolve(true);
  const running = jobs.get(key);
  if (running) return running.promise;
  if (kind !== 'brilliant') return Promise.resolve(false);
  const r = createBrilliantRenderer(sr);
  const len = Math.ceil(BRILLIANT_DURATION * sr) + 1; // same length as synthesize()
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  jobs.set(key, { promise });
  const slice = (deadline) => {
    const t0 = now();
    const budget = deadline && typeof deadline.timeRemaining === 'function' && !deadline.didTimeout
      ? Math.max(1, Math.min(8, deadline.timeRemaining() - 1))
      : SLICE_MS;
    let finished = false;
    try {
      do { finished = r.step(SLICE_SAMPLES); } while (!finished && now() - t0 < budget);
    } catch { jobs.delete(key); resolve(false); return; }
    stats.slices++;
    stats.maxSliceMs = Math.max(stats.maxSliceMs, now() - t0);
    if (!finished) { idle(slice); return; }
    const out = new Float32Array(len);
    const d = r.data;
    for (let i = 0; i < d.length && i < len; i++) out[i] = Math.max(-1, Math.min(1, d[i]));
    rendered.set(key, out);
    jobs.delete(key);
    // Once the context's own rate is ready, drop copies at other rates.
    if (ctx && ctx.sampleRate === sr) {
      for (const k of [...rendered.keys()]) if (k !== key && k.startsWith(kind + '@')) rendered.delete(k);
    }
    // Make the AudioBuffer now as well, so the first play only starts it.
    const c = ctx;
    if (c && c.state !== 'closed' && !buffers.has(kind)) { try { getBuffer(c, kind); } catch { /* ignore */ } }
    resolve(true);
  };
  idle(slice);
  return promise;
}

function getBuffer(c, kind) {
  let buf = buffers.get(kind);
  if (buf) return buf;
  const ctxRate = c.sampleRate || 44100;
  let data, sr = ctxRate;
  if (HEAVY.has(kind)) {
    const got = heavySamples(kind, ctxRate);
    if (!got) { renderHeavy(kind, ctxRate); return null; }
    ({ data, sr } = got);
    // Rendered at another rate (before the context existed): play it, and
    // render the native rate in the background for later.
    if (sr !== ctxRate) renderHeavy(kind, ctxRate);
  } else {
    data = synthesize(kind, sr);
  }
  if (!data) return null;
  buf = c.createBuffer(1, data.length, sr);
  buf.getChannelData(0).set(data);
  if (sr === ctxRate) buffers.set(kind, buf);
  return buf;
}

// Render the buffers shortly after the context exists, one per idle slice
// (move first), so the first move does not pay for synthesis and no single
// slice blocks a slow phone for long. Heavy sounds get their own sliced job.
function prewarm(c) {
  const todo = SOUND_KINDS.filter((k) => !HEAVY.has(k));
  for (const k of HEAVY) renderHeavy(k, c.sampleRate || 44100);
  const step = () => {
    if (ctx !== c || !todo.length) return;
    try { getBuffer(c, todo.shift()); } catch { /* ignore */ }
    idle(step);
  };
  idle(step);
}

/**
 * Starts rendering a slow sound during idle time without creating an audio
 * context (the Game Review calls it when it opens). Resolves to true when
 * the sound is ready. Never blocks.
 */
export function preloadSound(kind = 'brilliant') {
  if (!HEAVY.has(kind)) return Promise.resolve(!!RECIPES[kind]);
  const sr = (ctx && ctx.state !== 'closed' && ctx.sampleRate) || lastRate || 48000;
  return renderHeavy(kind, sr);
}

/** True when play(kind) would start that sound itself rather than its fallback. */
export function soundReady(kind) {
  if (!RECIPES[kind]) return false;
  if (!HEAVY.has(kind)) return true;
  return !!heavySamples(kind, (ctx && ctx.sampleRate) || lastRate || 48000);
}

// ---------------------------------------------------------------------------
// Context lifecycle.

function onStateChange() {
  const c = ctx;
  if (!c) return;
  if (c.state === 'running') {
    unlocked = true;
    clockSample = { ct: c.currentTime, wall: now() };
    flushPending();
  }
}

function createContext() {
  if (!AC) return null;
  let c = null;
  try { c = new AC({ latencyHint: 'interactive' }); } catch { try { c = new AC(); } catch { return null; } }
  ctx = c;
  lastRate = c.sampleRate || lastRate;
  stats.contexts++;
  buffers = new Map();
  voices = [];
  unlocked = false;
  dead = false;
  resuming = false;
  clockSample = { ct: -1, wall: now() };
  try {
    master = c.createGain();
    master.gain.value = VOLUME;
    master.connect(c.destination);
  } catch { master = null; }
  try { if (c.addEventListener) c.addEventListener('statechange', onStateChange); else c.onstatechange = onStateChange; } catch { c.onstatechange = onStateChange; }
  prewarm(c);
  return c;
}

function getContext() {
  if (ctx && ctx.state !== 'closed') return ctx;
  return createContext();
}

function replaceContext() {
  const old = ctx;
  ctx = null; master = null;
  // Detach the old context's listener before closing it.
  if (old) { try { if (old.removeEventListener) old.removeEventListener('statechange', onStateChange); old.onstatechange = null; } catch { /* ignore */ } }
  if (old) { try { const p = old.close(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  stats.recreated++;
  return createContext();
}

// Starts resume() at most once at a time. Settles when the context runs or
// after RESUME_WAIT_MS, because resume() can stay pending outside a gesture.
function requestResume(c, fromGesture = false) {
  if (!c || c.state === 'running' || c.state === 'closed') return Promise.resolve();
  if (resuming && !fromGesture) return Promise.resolve();
  resuming = true;
  let p;
  try { p = c.resume(); } catch { p = null; }
  const done = () => {
    if (ctx === c) resuming = false;
    if (c.state === 'running') { onStateChange(); return; }
    // Resuming inside a real gesture should always work. If it did not, the
    // context is wedged (seen on iOS after an interruption): replace it on the
    // next gesture.
    if (fromGesture && ctx === c) dead = true;
  };
  if (!p || typeof p.then !== 'function') { done(); return Promise.resolve(); }
  return Promise.race([p.then(() => {}, () => {}), new Promise((r) => setTimeout(r, RESUME_WAIT_MS))]).then(done);
}

// The clock of a running context must advance. If it has not moved for
// STUCK_MS of wall time, the output is dead even though state says running.
function clockStuck(c) {
  const t = now();
  const ct = c.currentTime;
  if (ct !== clockSample.ct) { clockSample = { ct, wall: t }; return false; }
  return t - clockSample.wall > STUCK_MS;
}

function unlockFromGesture() {
  let c = ctx;
  if (!c || c.state === 'closed' || dead) c = ctx ? replaceContext() : createContext();
  if (!c) return;
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate || 22050);
    src.connect(c.destination);
    src.start(0);
  } catch { /* ignore */ }
  requestResume(c, true);
}

function onGesture() {
  // Keep listening after the first unlock: iOS can suspend or interrupt the
  // context again later, and the next tap is the only reliable chance to
  // restart it.
  if (!enabled && unlocked) return;
  if (ctx && ctx.state === 'running' && unlocked && !dead) {
    if (!clockStuck(ctx)) return;
    dead = true;
  }
  unlockFromGesture();
}

function onVisible() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const c = ctx;
  if (!c || c.state === 'closed') return;
  if (c.state !== 'running') { requestResume(c); return; }
  // Running after coming back: verify the clock still moves.
  const ct = c.currentTime;
  setTimeout(() => { if (ctx === c && c.state === 'running' && c.currentTime === ct) dead = true; }, STUCK_MS);
}

let installed = false;
export function installAudioUnlock() {
  if (installed || typeof window === 'undefined' || !AC) return;
  installed = true;
  const opts = { capture: true, passive: true };
  for (const type of GESTURES) window.addEventListener(type, onGesture, opts);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  window.addEventListener('focus', onVisible);
}
installAudioUnlock();

/** Test hook: reports the shared context state without creating one. */
export function audioState() {
  return { hasContext: !!ctx, state: ctx ? ctx.state : 'none', unlocked, dead, pending: pending ? pending.kind : null, voices: voices.length, buffers: buffers.size, ...stats };
}

// ---------------------------------------------------------------------------
// Playback.

function stopAll() {
  for (const v of voices) { try { v.stop(); } catch { /* ignore */ } }
  voices = [];
}

function startNow(c, kind, fallback = null) {
  let buf = getBuffer(c, kind);
  // A heavy sound that is still rendering: play the caller's fallback now
  // rather than render it here (getBuffer has queued the render).
  if (!buf && fallback && fallback !== kind && RECIPES[fallback] && !HEAVY.has(fallback)) {
    buf = getBuffer(c, fallback);
    if (buf) stats.fallbacks++;
  }
  if (!buf) return false;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(master || c.destination);
  voices.push(src);
  src.onended = () => { const i = voices.indexOf(src); if (i >= 0) voices.splice(i, 1); };
  while (voices.length > MAX_VOICES) { const old = voices.shift(); try { old.stop(); } catch { /* ignore */ } }
  src.start(0);
  stats.started++;
  return true;
}

function flushPending() {
  if (!pending) return;
  const p = pending;
  const c = ctx;
  if (!c || c.state !== 'running') return;
  pending = null;
  if (!enabled || now() - p.at > PENDING_MAX_MS) { stats.dropped++; return; }
  try { startNow(c, p.kind, p.fallback); } catch { /* ignore */ }
}

function queue(kind, fallback) {
  if (pending) stats.dropped++;
  pending = { kind, fallback, at: now() };
  stats.queued++;
  setTimeout(() => { if (pending && now() - pending.at > PENDING_MAX_MS) { pending = null; stats.dropped++; } }, PENDING_MAX_MS + 50);
}

/**
 * Plays a sound effect. Returns true when it was started immediately.
 * options.fallback names a sound to play instead when `kind` is a slow sound
 * that has not finished rendering yet (the Brilliant chime); without it, such
 * a request is silent. Either way play() never synthesises a slow sound.
 */
export function play(kind, { fallback = null } = {}) {
  if (!enabled || !RECIPES[kind]) return false;
  stats.requested++;
  try {
    let c = getContext();
    if (!c) return false;
    // A dead context can only be replaced inside a gesture; navigator
    // .userActivation tells us when we are in one (Chrome, Safari 16.4+).
    const active = typeof navigator !== 'undefined' && navigator.userActivation && navigator.userActivation.isActive;
    if (c.state === 'running' && clockStuck(c)) dead = true;
    if (dead && active) { c = replaceContext(); if (!c) return false; unlockFromGesture(); }
    if (c.state === 'running' && !dead) return startNow(c, kind, fallback);
    queue(kind, fallback);
    requestResume(c, !!active);
    return false;
  } catch { return false; }
}

export function soundForMove(move, positionAfter) {
  if (positionAfter && positionAfter.inCheck()) return 'check';
  if (move.promotion) return 'promote';
  if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) return 'castle';
  if (move.captured) return 'capture';
  return 'move';
}
