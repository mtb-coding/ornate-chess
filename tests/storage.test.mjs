/**
 * Storage module tests — injectable MemoryStorage backend.
 * PGN round-trips run only when engine.js is importable.
 */
import assert from 'node:assert/strict';
import {
  MemoryStorage,
  ChessStorage,
  createStorage,
  DEFAULT_SETTINGS,
  MAX_SAVED_GAMES,
  SCHEMA_VERSION,
  STORAGE_PREFIX,
  ensureGameLoaded,
} from '../src/storage.js';

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, ok: true });
  } catch (e) {
    failed++;
    results.push({ name, ok: false, error: e.message });
    console.error(`FAIL  ${name}\n  ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, ok: true });
  } catch (e) {
    failed++;
    results.push({ name, ok: false, error: e.message });
    console.error(`FAIL  ${name}\n  ${e.message}`);
  }
}

function sampleGameJSON(uci = []) {
  return {
    version: 1,
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    uci,
    resultInfo: null,
  };
}

function sampleRecord(overrides = {}) {
  return {
    name: 'Test Game',
    mode: 'bot',
    botLevel: 'lvl4',
    playerColor: 'w',
    game: sampleGameJSON(['e2e4', 'e7e5']),
    clock: null,
    ...overrides,
  };
}

function fresh() {
  return createStorage({ backend: new MemoryStorage() });
}

// ─── Backend / schema ────────────────────────────────────────────

test('MemoryStorage get/set/remove', () => {
  const m = new MemoryStorage();
  assert.equal(m.getItem('a'), null);
  m.setItem('a', '1');
  assert.equal(m.getItem('a'), '1');
  m.removeItem('a');
  assert.equal(m.getItem('a'), null);
});

test('createStorage uses injectable backend', () => {
  const backend = new MemoryStorage();
  const s = createStorage({ backend });
  s.setSettings({ sound: false });
  assert.equal(backend.getItem(`${STORAGE_PREFIX}settings`) != null, true);
  const s2 = createStorage({ backend });
  assert.equal(s2.getSettings().sound, false);
});

test('schema version written on init', () => {
  const backend = new MemoryStorage();
  createStorage({ backend });
  const schema = JSON.parse(backend.getItem(`${STORAGE_PREFIX}schema`));
  assert.equal(schema.version, SCHEMA_VERSION);
});

test('corrupted JSON for settings resets only that key', () => {
  const backend = new MemoryStorage();
  const s = createStorage({ backend });
  s.setSettings({ theme: 'ivory' });
  backend.setItem(`${STORAGE_PREFIX}settings`, '{not-json');
  backend.setItem(`${STORAGE_PREFIX}stats`, JSON.stringify({ version: 1, byLevel: {}, totals: { wins: 1, losses: 0, draws: 0, games: 1 } }));
  const s2 = createStorage({ backend });
  assert.equal(s2.getSettings().theme, DEFAULT_SETTINGS.theme);
  assert.equal(s2.getStats().totals.wins, 1);
  // corrupted settings key removed
  assert.equal(backend.getItem(`${STORAGE_PREFIX}settings`), null);
});

test('corrupted games list resets to empty array', () => {
  const backend = new MemoryStorage();
  createStorage({ backend });
  backend.setItem(`${STORAGE_PREFIX}games`, '@@@');
  const s = createStorage({ backend });
  assert.deepEqual(s.listGames(), []);
});

// ─── Settings ────────────────────────────────────────────────────

test('getSettings returns defaults', () => {
  const s = fresh();
  assert.deepEqual(s.getSettings(), { ...DEFAULT_SETTINGS });
});

test('setSettings merges patch and ignores unknown keys', () => {
  const s = fresh();
  const next = s.setSettings({ sound: false, notARealKey: 1 });
  assert.equal(next.sound, false);
  assert.equal('notARealKey' in next, false);
  assert.equal(s.getSettings().theme, 'ebony');
});

test('setSettings rejects non-object', () => {
  const s = fresh();
  assert.throws(() => s.setSettings(null), /object patch/);
});

// ─── Named saves ─────────────────────────────────────────────────

test('saveGame returns id and listGames summarizes', () => {
  const s = fresh();
  const id = s.saveGame(sampleRecord({ name: 'Sicilian Study' }));
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
  const list = s.listGames();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Sicilian Study');
  assert.equal(list[0].mode, 'bot');
  assert.equal(list[0].plyCount, 2);
  assert.equal(list[0].id, id);
});

test('loadGame round-trips full record', () => {
  const s = fresh();
  const id = s.saveGame(sampleRecord({ name: 'R1', clock: { wMs: 60000, bMs: 60000, incMs: 0 } }));
  const loaded = s.loadGame(id);
  assert.equal(loaded.name, 'R1');
  assert.equal(loaded.game.uci.length, 2);
  assert.equal(loaded.clock.wMs, 60000);
});

test('saveGame updates existing id', () => {
  const s = fresh();
  const id = s.saveGame(sampleRecord({ name: 'A' }));
  const id2 = s.saveGame(sampleRecord({ id, name: 'B' }));
  assert.equal(id, id2);
  assert.equal(s.listGames().length, 1);
  assert.equal(s.loadGame(id).name, 'B');
});

test('deleteGame and renameGame', () => {
  const s = fresh();
  const id = s.saveGame(sampleRecord({ name: 'Old' }));
  assert.equal(s.renameGame(id, 'New'), true);
  assert.equal(s.loadGame(id).name, 'New');
  assert.equal(s.deleteGame(id), true);
  assert.equal(s.loadGame(id), null);
  assert.equal(s.deleteGame(id), false);
});

test('saveGame validates required fields', () => {
  const s = fresh();
  assert.throws(() => s.saveGame({ mode: 'bot', game: sampleGameJSON() }), /name/);
  assert.throws(() => s.saveGame({ name: 'x', mode: 'nope', game: sampleGameJSON() }), /mode/);
  assert.throws(() => s.saveGame({ name: 'x', mode: 'bot' }), /game object/);
  assert.throws(() => s.saveGame({ name: 'x', mode: 'bot', game: { version: 2, startFen: 'x', uci: [] } }), /version/);
});

test('save list capped at MAX_SAVED_GAMES', () => {
  const s = fresh();
  for (let i = 0; i < MAX_SAVED_GAMES + 5; i++) {
    s.saveGame(sampleRecord({ name: `G${i}` }));
  }
  assert.equal(s.listGames().length, MAX_SAVED_GAMES);
  // newest first
  assert.equal(s.listGames()[0].name, `G${MAX_SAVED_GAMES + 4}`);
});

// ─── Autosave ────────────────────────────────────────────────────

test('autosave save/load/clear', () => {
  const s = fresh();
  assert.equal(s.loadAutosave(), null);
  s.saveAutosave(sampleRecord({ name: 'Auto' }));
  const a = s.loadAutosave();
  assert.equal(a.name, 'Auto');
  assert.equal(a.game.uci.length, 2);
  s.clearAutosave();
  assert.equal(s.loadAutosave(), null);
});

// ─── File export/import (shape; Game validation soft without engine) ─

test('exportGameFile / importGameFile round-trip', () => {
  const s = fresh();
  const rec = sampleRecord({ name: 'Export Me', id: 'abc' });
  const text = s.exportGameFile(rec);
  assert.equal(typeof text, 'string');
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, 'ornate-chess-save');
  assert.equal(parsed.version, SCHEMA_VERSION);
  const imported = s.importGameFile(text);
  assert.equal(imported.name, 'Export Me');
  assert.equal(imported.game.uci[0], 'e2e4');
});

test('importGameFile accepts bare record', () => {
  const s = fresh();
  const bare = sampleRecord({ name: 'Bare' });
  const imported = s.importGameFile(JSON.stringify(bare));
  assert.equal(imported.name, 'Bare');
});

test('importGameFile readable errors', () => {
  const s = fresh();
  assert.throws(() => s.importGameFile(''), /empty/);
  assert.throws(() => s.importGameFile('{'), /not valid JSON/);
  assert.throws(() => s.importGameFile('{"foo":1}'), /not a recognized/);
  assert.throws(
    () =>
      s.importGameFile(
        JSON.stringify({ format: 'ornate-chess-save', version: 99, record: sampleRecord() })
      ),
    /newer than this app/
  );
});

// ─── Stats ───────────────────────────────────────────────────────

test('recordResult tracks wins/losses/draws per level', () => {
  const s = fresh();
  s.recordResult({ mode: 'bot', botLevel: 'lvl3', playerColor: 'w', result: '1-0' });
  s.recordResult({ mode: 'bot', botLevel: 'lvl3', playerColor: 'w', result: '0-1' });
  s.recordResult({ mode: 'bot', botLevel: 'lvl3', playerColor: 'w', result: '1/2-1/2' });
  s.recordResult({ mode: 'bot', botLevel: 'lvl5', playerColor: 'b', result: '0-1' });
  const stats = s.getStats();
  assert.equal(stats.byLevel.lvl3.wins, 1);
  assert.equal(stats.byLevel.lvl3.losses, 1);
  assert.equal(stats.byLevel.lvl3.draws, 1);
  assert.equal(stats.byLevel.lvl5.wins, 1);
  assert.equal(stats.totals.games, 4);
});

test('recordResult rejects bad result', () => {
  const s = fresh();
  assert.throws(() => s.recordResult({ result: 'win' }), /1-0/);
});

// ─── Puzzle progress / Elo ───────────────────────────────────────

test('puzzle progress defaults and getRating', () => {
  const s = fresh();
  assert.equal(s.getRating(), 1200);
  const p = s.getPuzzleProgress();
  assert.equal(p.rating, 1200);
  assert.deepEqual(p.puzzles, {});
});

test('markPuzzle solve raises rating vs equal opponent', () => {
  const s = fresh();
  const before = s.getRating();
  s.markPuzzle('p1', { solved: true, attempts: 1, usedHint: false, puzzleRating: 1200 });
  assert.ok(s.getRating() > before);
  assert.equal(s.getPuzzleProgress().puzzles.p1.solved, true);
});

test('markPuzzle fail lowers rating', () => {
  const s = fresh();
  const before = s.getRating();
  s.markPuzzle('p2', { solved: false, attempts: 1, usedHint: false, puzzleRating: 1200 });
  assert.ok(s.getRating() < before);
});

test('markPuzzle hint reduces gain; re-solve does not change rating', () => {
  const s = fresh();
  s.markPuzzle('p3', { solved: true, attempts: 1, usedHint: true, puzzleRating: 1200 });
  const afterHint = s.getRating();
  s.markPuzzle('p3', { solved: true, attempts: 2, usedHint: true, puzzleRating: 1200 });
  assert.equal(s.getRating(), afterHint);
});

test('markPuzzle with hint gains less than clean solve', () => {
  const a = fresh();
  const b = fresh();
  a.markPuzzle('x', { solved: true, attempts: 1, usedHint: false, puzzleRating: 1200 });
  b.markPuzzle('x', { solved: true, attempts: 1, usedHint: true, puzzleRating: 1200 });
  assert.ok(a.getRating() > b.getRating());
});

// ─── PGN (requires engine) ───────────────────────────────────────

let engineOk = false;
try {
  await ensureGameLoaded();
  engineOk = true;
} catch {
  engineOk = false;
}

if (engineOk) {
  await testAsync('exportPgn / importPgn round-trip', async () => {
    const s = fresh();
    // Build a real game via engine
    const { Game } = await import('../src/engine.js');
    const g = new Game();
    const m1 = g.position.parseUci('e2e4');
    assert.ok(m1);
    g.play(m1);
    const m2 = g.position.parseUci('e7e5');
    g.play(m2);
    const rec = sampleRecord({ name: 'Open Game', game: g.toJSON() });
    const pgn = s.exportPgn(rec);
    assert.ok(pgn.includes('e4'));
    const imported = s.importPgn(pgn);
    assert.equal(imported.mode, 'analysis');
    assert.ok(imported.game.uci.length >= 2);
  });

  await testAsync('importGameFile validates via Game.fromJSON', async () => {
    const s = fresh();
    const { Game } = await import('../src/engine.js');
    const g = new Game();
    const text = s.exportGameFile(sampleRecord({ name: 'V', game: g.toJSON() }));
    const imp = s.importGameFile(text);
    assert.equal(imp.name, 'V');
  });
} else {
  console.log('SKIP  PGN tests (engine.js not ready)');
}

// ─── Endgame progress and colour stats ───────────────────────────

test('recordResult also stores wins by colour and optional opening', () => {
  const s = fresh();
  s.recordResult({ mode: 'bot', botLevel: 'lvl3', playerColor: 'w', result: '1-0', opening: { name: 'Sicilian Defence', eco: 'B20' } });
  s.recordResult({ mode: 'bot', botLevel: 'lvl3', playerColor: 'b', result: '1-0' });
  const stats = s.getStats();
  assert.equal(stats.byColor.w.wins, 1);
  assert.equal(stats.byColor.b.losses, 1);
  assert.equal(stats.byOpening['B20'].wins, 1);
  assert.equal(stats.byOpening['B20'].eco, 'B20');
  assert.equal(stats.byOpening['B20'].name, 'Sicilian Defence');
  assert.equal(stats.byLevel.lvl3.wins, 1);
  assert.equal(stats.byLevel.lvl3.losses, 1);
});

test('endgame progress is stored, incremented and sanitised', () => {
  const s = fresh();
  let p = s.getEndgameProgress();
  assert.deepEqual(p.positions, {});
  s.markEndgame('lucena', { completed: false, usedHint: true });
  s.markEndgame('lucena', { completed: true });
  p = s.getEndgameProgress();
  assert.equal(p.positions.lucena.attempts, 2);
  assert.equal(p.positions.lucena.completed, true);
  assert.equal(p.positions.lucena.usedHint, true);
  assert.throws(() => s.markEndgame(''), /id/);
  s.backend.setItem('ornate-chess:endgame-progress', '{"positions":{"x":{"completed":"yes","attempts":-3},"y":{"completed":"no","attempts":2}}}');
  const clean = s.getEndgameProgress();
  assert.equal(clean.positions.x.completed, false);
  assert.equal(clean.positions.x.attempts, 0);
  assert.equal(clean.positions.y.completed, false);
  assert.equal(clean.positions.y.attempts, 2);
  s.backend.setItem('ornate-chess:endgame-progress', '{"positions":{"z":{"completed":true,"attempts":1}}}');
  assert.equal(s.getEndgameProgress().positions.z.completed, true);
  s.backend.setItem('ornate-chess:player-rating', '{"rating":1284,"games":-1,"wins":"3","draws":0,"losses":0,"peak":1284,"history":[]}');
  const rating = s.getPlayerRating();
  assert.equal(rating.games, 0);
  assert.equal(rating.wins, 0);
  assert.ok(rating.rating >= 0);
});

// ─── Summary ─────────────────────────────────────────────────────

console.log(`\nStorage tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
