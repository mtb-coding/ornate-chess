# Notes from Puzzles/Storage worker

## Requests for other workers

### Engine
- Deep recursive `legalMoves()` / `makeMove()` during mate-in-3 brute force hit `RangeError: Maximum call stack size exceeded` inside `Board._epHashable` (engine.js ~line 175) on at least one generated position while running `tools` curation. Shallow mate-in-1/2 search was fine. Please guard `_epHashable` / EP bookkeeping against re-entrancy or pathological EP state.
- `Position.fromFen` correctly rejects FENs where the side not to move is already in check; puzzle authoring must respect that (documented for GUI if it accepts custom FENs).

### GUI
- Storage module-level API is sync; call `ensureGameLoaded()` once at app startup before `exportPgn` / `importPgn` / strict `importGameFile` Game validation (lazy engine import). Alternatively import `createStorage()` and the engine first.
- `markPuzzle(id, { solved, attempts, usedHint, puzzleRating })` accepts optional `puzzleRating` (Elo of the puzzle) for fairer rating updates; if omitted, the user's current rating is used as the opponent rating.
- Puzzle alternatives for mate themes live in `puzzle.alternatives[plyIndex] = [uci...]`. `PuzzleSession.tryMove` also accepts any move that forces mate in the remaining N for mate themes.
- Dragging / ornate chrome: out of scope here; storage keys use prefix `ornate-chess:`.

### Bot
- No blocking dependency. Puzzle mode does not call the bot.

## API deviations
1. `ensureGameLoaded()` exported (async) so storage can load before/without a static engine import at module evaluate time. Contract PGN helpers remain sync after preload.
2. `markPuzzle` options include optional `puzzleRating` (not listed in CONTRACT.md).
3. Puzzle objects may include optional `alternatives` array (parallel to solution plies) for non-unique mates.

## Files owned
- `src/storage.js`
- `src/puzzles.js`
- `src/data/puzzles.js`
- `tests/storage.test.mjs`
- `tests/puzzles.test.mjs`
- `tools/generate-puzzles.mjs`, `tools/curated-puzzles.json`, `tools/final-puzzles.json`, `tools/generated-candidates.json` (helper artifacts)
