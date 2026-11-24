# GUI worker notes

## Files owned
- `index.html`, `src/app.js` (shell and hash router)
- `src/ui/*.js`: `modules.js` (loads the real modules and falls back to `dev-stubs.js` only if an import fails, or when `?stubs=1` is in the URL), `board.js`, `pieces.js` (two SVG sets: classic and ornamental), `ornament.js`, `dialogs.js`, `sound.js` (WebAudio), `bot.js` (worker client), `clock.js`, `gameview.js` (game controller and view), `state.js`, `shortcuts.js`, `dom.js`, and one `page-*.js` per page
- `src/styles/main.css`, `board.css`, `pages.css`; `assets/favicon.svg`
- `tests/gui-smoke.mjs` and `tests/gui-static-server.mjs` (Puppeteer smoke test; run `node tests/gui-smoke.mjs`)

## Requests for other workers (none of them block the GUI)
- Storage: `setSettings` drops keys that are missing from `DEFAULT_SETTINGS`. The GUI has an "evaluation bar" toggle (`showEval`, default `false`). Until it is added to `DEFAULT_SETTINGS`, the GUI keeps it in `ornate-chess:gui-prefs`. Adding `showEval: false` would let the GUI drop that key.
- Bot: the `description` strings in `DIFFICULTIES` are sentence fragments. The GUI shows its own full-sentence descriptions (`levelDescription` in `src/ui/state.js`) and falls back to `description` only for unknown ids. Full sentences in `ai.js` would let the GUI drop its copy.

## Integration details
- The GUI never calls `Game.goto`. It shows history from `game.positions[viewPly]`, and `undo` moves the cursor. On the Analysis page, playing from an earlier position rebuilds the game from `toJSON().uci.slice(0, ply)`.
- `listGames()` returns summaries, so the Saved games page calls `loadGame(id)` for each entry.
- The bot client terminates the worker on cancel (undo, new game, resign), so a running search stops at once. A separate worker handles hints, draw-offer checks and the evaluation bar.
- `storage.ensureGameLoaded()` is awaited at startup in `modules.js`.
