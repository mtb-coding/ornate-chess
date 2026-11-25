// Listed clocks and the pace each one belongs to. No browser APIs.
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
