// The Brilliant move sound for the Game Review. It is original and synthesised
// here sample by sample, with no audio file: a soft wooden knock (so the move
// itself is still heard), a rising C major glockenspiel arpeggio (C6 E6 G6 C7)
// with inharmonic bell partials, a warm low C and G underneath, and a short
// sparkle of tiny high pings. It lasts 0.8 s, peaks at 0.55 and ends in
// silence. sound.js renders it once per sample rate into an AudioBuffer.
//
// Rendering it takes tens of milliseconds on a slow phone, so it can also be
// rendered in small slices (createBrilliantRenderer) that sound.js spreads
// over idle time. Both paths produce identical samples.

export const BRILLIANT_DURATION = 0.8;

// Small deterministic PRNG so the sound is identical every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns an incremental renderer for the Brilliant sound. Each call to
 * step(maxSamples) renders at most that many output samples and returns true
 * once the sound is complete; data then holds the finished samples.
 */
export function createBrilliantRenderer(sampleRate = 48000) {
  const sr = sampleRate;
  const n = Math.ceil(sr * BRILLIANT_DURATION);
  const d = new Float32Array(n);
  const TAU = Math.PI * 2;
  const tones = [];
  const addTone = (start, freq, amp, decay, attack = 0.004) => {
    const s0 = Math.floor(start * sr);
    const len = Math.min(n - s0, Math.ceil(decay * 7 * sr));
    if (len > 0) tones.push({ s0, len, freq, amp, decay, attack });
  };
  // Glockenspiel-like note: fundamental plus inharmonic bell partials.
  const chime = (start, f, amp) => {
    addTone(start, f, amp, 0.32);
    addTone(start, f * 2.76, amp * 0.32, 0.12);
    addTone(start, f * 5.40, amp * 0.12, 0.05);
  };
  // Wood knock: low-passed decaying noise plus a falling sine body. It is
  // short (70 ms), so it is written up front; it also has to consume the
  // PRNG before the sparkle parameters below.
  const r = rng(31);
  const knockLen = Math.floor(0.07 * sr);
  let lp = 0;
  for (let i = 0; i < knockLen && i < n; i++) {
    const t = i / sr;
    const env = Math.pow(1 - i / knockLen, 3);
    lp += 0.35 * ((r() * 2 - 1) - lp);
    d[i] += 0.35 * env * lp + 0.25 * env * Math.sin(TAU * (170 - 60 * t / 0.07) * t);
  }
  // Rising arpeggio, the top note slightly louder.
  [1046.5, 1318.5, 1568.0, 2093.0].forEach((f, k) => chime(0.045 + k * 0.055, f, k === 3 ? 0.30 : 0.24));
  // Warm root and fifth under the arpeggio.
  addTone(0.045, 523.25, 0.10, 0.22, 0.01);
  addTone(0.045, 784.0, 0.05, 0.18, 0.01);
  // Sparkle: short, quiet, very high pings scattered after the top note.
  for (let k = 0; k < 9; k++) {
    const start = 0.2 + r() * 0.3;
    const f = 3500 + r() * 3500;
    addTone(start, f, 0.035 + r() * 0.025, 0.03, 0.002);
  }

  let pos = 0;          // next output sample whose tones are not yet added
  let done = false;
  const finish = () => {
    // Normalise to a peak of 0.55 and fade the last 40 ms to silence.
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    const scale = peak > 0 ? 0.55 / peak : 1;
    const fade = Math.floor(0.04 * sr);
    for (let i = 0; i < n; i++) d[i] *= scale * (n - i < fade ? (n - i) / fade : 1);
    done = true;
  };
  const step = (maxSamples = n) => {
    if (done) return true;
    if (pos >= n) { finish(); return true; }
    const end = Math.min(n, pos + Math.max(1, maxSamples | 0));
    // Tones are added in the same order for every sample, so the sums are
    // bit-identical to rendering the whole sound in one go.
    for (const tn of tones) {
      const a = Math.max(pos, tn.s0), b = Math.min(end, tn.s0 + tn.len);
      for (let s = a; s < b; s++) {
        const i = s - tn.s0;
        const t = i / sr;
        const env = (t < tn.attack ? t / tn.attack : 1) * Math.exp(-t / tn.decay);
        d[s] += tn.amp * env * Math.sin(TAU * tn.freq * t);
      }
    }
    pos = end;
    return false;
  };
  return { sampleRate: sr, length: n, step, get done() { return done; }, get progress() { return done ? 1 : pos / n; }, data: d };
}

/** Returns the Brilliant sound as mono samples at the given sample rate. */
export function synthBrilliant(sampleRate = 48000) {
  const r = createBrilliantRenderer(sampleRate);
  while (!r.step(r.length)) { /* render everything */ }
  return r.data;
}
