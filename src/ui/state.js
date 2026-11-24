// Shared application state: settings cache, pending loads and the active
// controllers that survive route changes.
import { mods } from './modules.js';

export const app = {
  settings: null,
  pendingLoad: null, // { target: 'play'|'local'|'analysis', record }
  controllers: {},   // route name -> controller kept alive across navigation
  listeners: new Set(),
};

// GUI-only preferences that storage.js does not persist (for example showEval)
// are kept under a separate key; see NOTES-gui.md.
const EXTRA_KEY = 'ornate-chess:gui-prefs';
const EXTRA_DEFAULTS = { showEval: false, boardPerspective: 'auto', ratedGames: true };
function readExtra() { try { return { ...EXTRA_DEFAULTS, ...JSON.parse(globalThis.localStorage.getItem(EXTRA_KEY) || '{}') }; } catch { return { ...EXTRA_DEFAULTS }; } }
function writeExtra(obj) { try { globalThis.localStorage.setItem(EXTRA_KEY, JSON.stringify(obj)); } catch { /* storage unavailable */ } }

export function settings() { return app.settings || (app.settings = { ...readExtra(), ...mods.storage.getSettings() }); }

export function updateSettings(patch) {
  let next = null;
  try { next = mods.storage.setSettings(patch); } catch (err) { console.warn('[settings]', err.message); }
  const extra = readExtra(); let extraChanged = false;
  for (const [k, v] of Object.entries(patch)) if (!next || !(k in next)) { extra[k] = v; extraChanged = true; }
  if (extraChanged) writeExtra(extra);
  app.settings = { ...settings(), ...patch, ...(next && typeof next === 'object' ? next : {}) };
  app.listeners.forEach((f) => f(app.settings));
  return app.settings;
}

export function onSettings(fn) { app.listeners.add(fn); return () => app.listeners.delete(fn); }

export function difficulty(id) {
  const list = mods.ai.DIFFICULTIES;
  return list.find((d) => d.id === id) || list[Math.min(3, list.length - 1)];
}

// Level descriptions written as complete sentences for the setup form.
const LEVEL_TEXT = {
  lvl1: 'The Novice level looks only one move ahead and often makes obvious mistakes. It suits players who are learning the moves.',
  lvl2: 'The Beginner level looks a short distance ahead and still leaves pieces undefended from time to time.',
  lvl3: 'The Casual level avoids simple blunders most of the time and uses a small opening book.',
  lvl4: 'The Club Player level plays consistently, makes occasional mistakes and has a basic sense of position.',
  lvl5: 'The Advanced level calculates several moves ahead and rarely loses material by accident.',
  lvl6: 'The Expert level searches deeply and punishes most tactical errors.',
  lvl7: 'The Master level plays strong positional and tactical chess and takes about two seconds per move.',
  lvl8: 'The Grandmaster level uses the full strength of the engine and takes up to three seconds per move.',
};
export function levelDescription(d) { return LEVEL_TEXT[d.id] || d.description || ''; }
