// Loads the real modules defined in CONTRACT.md. The development stubs in
// dev-stubs.js are used only when a real module fails to import, and the
// app reports that state in the footer and on window.__chess.stubs.
const loaded = { engine: null, ai: null, storage: null, puzzles: null, puzzleData: null, openings: null };
const usedStubs = [];

async function tryImport(path) {
  try { return await import(path); } catch (err) { console.warn(`[modules] ${path} unavailable: ${err.message}`); return null; }
}

export async function loadModules() {
  const forceStubs = new URLSearchParams(location.search).has('stubs');
  const real = forceStubs ? {} : {
    engine: await tryImport('../engine.js'),
    ai: await tryImport('../ai.js'),
    storage: await tryImport('../storage.js'),
    puzzles: await tryImport('../puzzles.js'),
    puzzleData: await tryImport('../data/puzzles.js'),
  };
  let stubs = null;
  const need = ['engine', 'ai', 'storage', 'puzzles', 'puzzleData'].filter((k) => !real[k] && !(k === 'puzzleData' && real.puzzles && real.puzzles.PUZZLES));
  if (need.length) {
    stubs = await import('./dev-stubs.js');
    usedStubs.push(...need);
  }
  loaded.engine = real.engine || stubs.engine;
  loaded.ai = real.ai || stubs.ai;
  loaded.storage = real.storage || stubs.storage;
  loaded.puzzles = real.puzzles || stubs.puzzles;
  loaded.puzzleData = real.puzzleData || (real.puzzles && real.puzzles.PUZZLES ? { PUZZLES: real.puzzles.PUZZLES } : stubs.puzzleData);
  // Opening names are optional: with the stub engine they are not loaded.
  loaded.openings = forceStubs || !real.engine ? null : await tryImport('../openings.js');
  // Build the opening index while the browser is idle so the first lookup is fast.
  if (loaded.openings) (globalThis.requestIdleCallback || ((f) => setTimeout(f, 50)))(() => { try { loaded.openings.identifyOpening([]); } catch { /* optional */ } });
  if (loaded.storage.ensureGameLoaded) { try { await loaded.storage.ensureGameLoaded(); } catch (err) { console.warn('[modules] storage could not load the engine:', err.message); } }
  return loaded;
}

export const mods = loaded;
export const stubsInUse = usedStubs;
export const engine = () => loaded.engine;
