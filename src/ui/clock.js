// Chess clock with presets and Fischer increments. The clock only measures
// time; the game controller decides what happens on a timeout.
export { CLOCK_PRESETS, clockMark } from '../clock-presets.js';
import { PREMOVE_MS } from '../premove.js';

export function formatClock(ms) {
  const t = Math.max(0, ms);
  if (t < 10e3) return `${Math.floor(t / 1000)}.${Math.floor((t % 1000) / 100)}`;
  const s = Math.ceil(t / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
}

export class Clock {
  constructor({ wMs, bMs, incMs = 0, onTick = () => {}, onFlag = () => {} }) {
    this.ms = { w: wMs, b: bMs }; this.incMs = incMs;
    this.running = null; this.since = 0; this.timer = null;
    this.onTick = onTick; this.onFlag = onFlag;
  }
  now(color) { return this.running === color ? this.ms[color] - (performance.now() - this.since) : this.ms[color]; }
  start(color) {
    this.stop();
    this.running = color; this.since = performance.now();
    this.timer = setInterval(() => {
      const left = this.now(color);
      this.onTick();
      if (left <= 0) { this.ms[color] = 0; this.stop(); this.onFlag(color); }
    }, 100);
    this.onTick();
  }
  stop() {
    if (this.running) { this.ms[this.running] = Math.max(0, this.now(this.running)); }
    this.running = null; clearInterval(this.timer); this.timer = null;
  }
  // Called after `color` completes a move.
  switchAfterMove(color) {
    const wasRunning = this.running === color;
    this.stop();
    if (wasRunning) this.ms[color] += this.incMs;
    this.start(color === 'w' ? 'b' : 'w');
  }
  // A premove replaces the time since the clock started with 0.1 seconds.
  // The bank is left untouched and the same side stays on the clock when
  // there is not more than 0.1 seconds left.
  premove(color) {
    const left = this.now(color);
    this.running = null;
    clearInterval(this.timer);
    this.timer = null;
    if (left <= PREMOVE_MS) {
      this.ms[color] = Math.max(0, left);
      this.start(color);
      return false;
    }
    this.ms[color] = left - PREMOVE_MS + this.incMs;
    this.start(color === 'w' ? 'b' : 'w');
    return true;
  }
  snapshot() { return { wMs: Math.round(this.now('w')), bMs: Math.round(this.now('b')), incMs: this.incMs }; }
}
