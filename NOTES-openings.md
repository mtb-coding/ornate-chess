# Opening recognition notes

## Data source
- Dataset: lichess-org/chess-openings, https://github.com/lichess-org/chess-openings
- Files: a.tsv, b.tsv, c.tsv, d.tsv, e.tsv, downloaded with curl from
  https://raw.githubusercontent.com/lichess-org/chess-openings/master/{a..e}.tsv
- Commit at retrieval: 3ba6b20d31b2e6125cb0e6a2e792f400717d9d39 (master)
- License: CC0-1.0 (Creative Commons Zero v1.0 Universal; the repository's COPYING.txt, copy in tools/openings-src/COPYING.txt)
- Retrieved: 2026-11-09
- SHA-256 of the raw files:
  - a.tsv 3282e4c9155289a29224f9a85fba0decb46efa35c2fa5e39662d2ac48fb0f793
  - b.tsv 2744a3890879bd9dce79093147fe5b6c3a9d9d42a3388af698e67b6829be1c48
  - c.tsv 447bbd4b15d68067b150faf12bf66aa14b18582cf80d736aaa7c0081131806ef
  - d.tsv 1cf4057a8aece94f27bb3f278ad410ee2844831a642364eeceaafa091dbcceda
  - e.tsv 48c6f6645b031a5937c8386839debab0e2e48837251687ba1afb6369677f8546
- No opening names were written by hand. All names and ECO codes come from these files.

## Build
`node tools/build-openings.mjs` reads tools/openings-src/*.tsv, replays every line with src/engine.js
(the build stops without writing if any move is illegal), removes exact duplicates, and writes
src/data/openings.js as one string with lines `ECO|Name|SAN moves`.

Result of the build on 2026-11-09: 3865 lines read, 3865 legal, 0 duplicates, 3865 written
(A=823, B=781, C=1250, D=644, E=367), 500 distinct ECO codes (A00 to E99), 3177 distinct names,
3865 distinct final positions. The generated file is about 340 KB.

## Module
`src/openings.js` exports `OPENINGS`, `identifyOpening(sanOrUciList)`, `identifyOpeningForGame(game, {ply})`
and `openingHeaders(result)`. The result is `{eco, name, plies, pgn, lastBookPly, matchedBy}`.
For every ply the matcher first looks for an exact move-sequence match and then for a position match
by `Position.hash()`, so transposed move orders are recognised (`matchedBy: 'transposition'`).
The deepest ply that matches wins; `lastBookPly` is that ply. Games from a custom FEN return null.
The position index (about 250 ms to build in Node) is built lazily, and the GUI warms it when idle.

## Changes in files owned by other workers (minimal and additive)
- src/storage.js: after the engine loads, it also imports ./openings.js (optional). `exportPgn` adds
  `[ECO "..."]` and `[Opening "..."]` when an opening matches. No storage format change.
- GUI: src/ui/modules.js (loads openings), src/ui/gameview.js (banner, PGN headers),
  src/ui/page-saved.js (ECO and name in saved-game entries), src/styles/board.css (banner styles),
  tests/gui-smoke.mjs (banner checks and screenshots).

## Same release: custom clock and board orientation (GUI)
- Custom clock (src/ui/page-game.js, src/styles/pages.css): a Custom button next to the clock presets on
  the Play and Two players pages reveals minutes per side (0.5 to 180, decimals allowed), increment
  seconds (0 to 60) and an optional "different amounts of time" toggle for Black. Errors are shown in a
  role="alert" box, Start is disabled with a visible reason, and the summary reads, for example,
  "The custom clock is ready: 7 minutes plus 3 seconds per move." The last values are kept in the
  GUI prefs key (`customClock`) and preselected next time.
- Board orientation (src/ui/gameview.js): orientation is derived in one place,
  `GameController.desiredOrientation()`, and applied by `syncOrientation()` at the start of every
  render. Bot games face the player's colour; two-player games with "Flip the board after each move"
  (setting `autoRotateLocal`, default on) face the side to move in the viewed position; a manual Flip
  inverts the result until Flip is selected again. Previously only a played move rotated the board, so
  Undo, history navigation and resumed games kept the wrong side, and the option was not restored on
  resume. Two-player games also gained a Redo button (Game.redo()).
