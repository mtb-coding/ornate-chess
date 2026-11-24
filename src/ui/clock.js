// Chess clock with presets and Fischer increments. The clock only measures
// time; the game controller decides what happens on a timeout.
export const CLOCK_PRESETS = [
  { id: 'none', label: 'No clock', baseMs: 0, incMs: 0 },
  { id: '1+0', label: '1 minute', baseMs: 60e3, incMs: 0 },
  { id: '3+2', label: '3 minutes plus 2 seconds per move', baseMs: 180e3, incMs: 2e3 },
  { id: '5+0', label: '5 minutes', baseMs: 300e3, incMs: 0 },
  { id: '5+3', label: '5 minutes plus 3 seconds per move', baseMs: 300e3, incMs: 3e3 },
  { id: '10+5', label: '10 minutes plus 5 seconds per move', baseMs: 600e3, incMs: 5e3 },
  { id: '15+10', label: '15 minutes plus 10 seconds per move', baseMs: 900e3, incMs: 10e3 },
  { id: '30+0', label: '30 minutes', baseMs: 1800e3, incMs: 0 },
];

const PACE_NAME = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid' };

// Compact "3 + 2" name, plus bullet, blitz or rapid. The length used for the
// pace is the starting time plus forty increments, which is how a game of
// that control usually goes. Under three minutes is bullet, under ten is
// blitz, and ten or more is rapid.
export function clockMark(baseMs, incMs) {
  const base = Number(baseMs);
  const inc = Number(incMs) || 0;
  if (!(base > 0)) return null;
  const mins = base / 60000;
  const minutes = Number.isInteger(mins) ? String(mins) : String(Math.round(mins * 100) / 100);
  const seconds = Math.round(inc / 1000);
  const estimate = base + 40 * inc;
  const pace = estimate < 3 * 60e3 ? 'bullet' : estimate < 10 * 60e3 ? 'blitz' : 'rapid';
  return { short: `${minutes} + ${seconds}`, pace, paceLabel: PACE_NAME[pace] };
}

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
  snapshot() { return { wMs: Math.round(this.now('w')), bMs: Math.round(this.now('b')), incMs: this.incMs }; }
}
