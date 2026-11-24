# Chess app: shared contract (all workers must follow this exactly)

Plain ES modules, no build step, no dependencies, runs by opening a static server on the folder (index.html at /workspace/chess/). Node 24 must be able to import the pure modules (engine, ai core, puzzles, storage logic) for tests: use only standard JS in those, no DOM at import time. Tests go in /workspace/chess/tests/ and run with `node tests/<name>.mjs` (plain asserts, exit code 1 on failure).

## Layout and ownership
- src/engine.js      : OWNER Engine worker. Rules, FEN, SAN, PGN.
- src/ai.js, src/ai-worker.js : OWNER Bot worker.
- index.html, src/app.js, src/ui/*.js, src/styles/*.css, assets/* : OWNER GUI worker.
- src/storage.js, src/puzzles.js, src/data/puzzles.js : OWNER Puzzles/Storage worker.
Never edit another worker's files. If you need a change, write it in NOTES-<yourname>.md at /workspace/chess/ and report it.

## engine.js API (named exports)
Squares are 0..63, a1=0, b1=1, ... h1=7, a2=8 ... h8=63. Colors are 'w' and 'b'. Piece types are 'p','n','b','r','q','k'. A piece is {color, type} or null.
- `START_FEN`
- `class Position`
  - `static fromFen(fen)`; `toFen()`
  - `turn` ('w'|'b'), `board` (array of 64 piece-or-null), `castling` ({wK,wQ,bK,bQ} booleans), `epSquare` (number|null), `halfmove`, `fullmove`
  - `legalMoves()` -> array of move objects `{from, to, piece, captured (type|null), promotion (type|undefined), flags}` where flags is a string containing any of: 'c' capture, 'e' en passant, 'k' kingside castle, 'q' queenside castle, 'p' promotion, 'd' double pawn push
  - `legalMovesFrom(sq)`
  - `makeMove(move)` -> NEW Position (immutable; the original is untouched)
  - `inCheck()`, `isCheckmate()`, `isStalemate()`, `isInsufficientMaterial()`, `isFiftyMoveDraw()`
  - `hash()` -> string key of piece placement + turn + castling + effective ep (for repetition)
  - `toSan(move)` -> SAN with +, #, disambiguation, O-O, O-O-O, =Q
  - `parseSan(san)` -> move or null
  - `parseUci(uci)` -> move or null (e2e4, e7e8q); `moveToUci(move)`
- `class Game`: full game with history
  - `constructor(startFen = START_FEN)`
  - `position` (current Position), `moves` (array of move objects played), `sans` (array), `positions` (array of Position, index 0 = start)
  - `play(move)` -> true/false (rejects illegal); `undo()`; `redo()` (redo stack cleared by a new play); `goto(plyIndex)` for navigation
  - `result()` -> null | {result:'1-0'|'0-1'|'1/2-1/2', reason:'checkmate'|'stalemate'|'threefold'|'fifty-move'|'insufficient'|'resignation'|'timeout'|'agreement'}; threefold and fifty-move are automatic draws here
  - `resign(color)`, `drawByAgreement()`, `timeout(color)`
  - `toPgn(headers = {})`, `static fromPgn(text)` (handles headers, comments in {}, variations in () skipped, NAGs, result tokens, FEN/SetUp header)
  - `toJSON()` / `static fromJSON(obj)` -> `{version:1, startFen, uci:[...], resultInfo}`; round-trips exactly
- `perft(position, depth)` -> node count (used for tests)
- `PIECE_VALUES` {p:100,n:320,b:330,r:500,q:900,k:0}

## ai.js API
- `DIFFICULTIES`: array of `{id, name, elo, depth, timeMs, blunderRate, randomness, description}`; at least 8 levels from "Novice" (~400 elo, plays weakly, makes visible mistakes) to "Grandmaster" (as strong as the engine can be in the browser within ~3s). Ids are 'lvl1'..'lvl8' (more allowed).
- `chooseMove(position, options)` -> `{move, score (centipawns, from side to move), depth, nodes, pv:[moves]}`; options `{difficultyId, timeMs?, history?: Position[] (for repetition awareness), signal?}`; async-capable (returns a Promise).
- `evaluate(position)` -> centipawns from white's view.
- `analyze(position, {depth|timeMs, multiPv})` -> array of `{move, score, pv}` used for hints and the evaluation bar.
- `src/ai-worker.js` is a module Web Worker: receives `{id, type:'choose'|'analyze', fen, historyFens, options}`, posts `{id, ok, result}` with moves serialized as UCI strings. The UI will use `new Worker('./src/ai-worker.js', {type:'module'})`.

## storage.js API (localStorage key prefix `ornate-chess:`)
- `saveGame(record)` -> id; `listGames()`; `loadGame(id)`; `deleteGame(id)`; `renameGame(id, name)`
- record = `{id?, name, savedAt, mode:'bot'|'local'|'puzzle'|'analysis', botLevel?, playerColor?, game: Game.toJSON(), clock?:{wMs,bMs,incMs}}`
- autosave slot: `saveAutosave(record)`, `loadAutosave()`, `clearAutosave()`
- `exportGameFile(record)` -> string JSON; `importGameFile(text)` -> record (validates, throws readable errors); `exportPgn(record)`; `importPgn(text)` -> record
- settings: `getSettings()`, `setSettings(patch)` with defaults `{theme:'ebony', pieceSet:'classic', boardStyle:'marble', sound:true, showLegal:true, showCoords:true, autoQueen:false, animations:true, lastBotLevel:'lvl4', hints:true}`
- stats: `recordResult({mode, botLevel, playerColor, result})`, `getStats()` (wins/losses/draws per level), puzzle progress `getPuzzleProgress()`, `markPuzzle(id, {solved, attempts, usedHint})`, `getRating()` puzzle rating via simple Elo update.
- Must work with an injectable storage backend (default `globalThis.localStorage`, fallback to in-memory) so Node tests run.

## puzzles.js API
- `data/puzzles.js` exports `PUZZLES`: array of `{id, title, theme ('mate-in-1'|'mate-in-2'|'mate-in-3'|'fork'|'pin'|'skewer'|'back-rank'|'discovered'|'sacrifice'|'endgame'|'promotion'|'deflection'|'zugzwang-ish'), difficulty (1-5), rating, fen, solution:[uci,...] (alternating: first is the move for the side to move, then the opponent reply, etc.), hint, explanation}`. At least 60 puzzles, all verified with engine.js (fen valid, every solution move legal in sequence, mate-in-N puzzles actually end in checkmate within N, any alternative mating first move accepted by the checker). Do NOT invent unverifiable "famous game" claims; titles are descriptive only.
- `puzzles.js` exports `PuzzleSession` class: `constructor(puzzle)`, `position`, `playerColor`, `tryMove(move)` -> `{status:'correct'|'complete'|'wrong', reply?: move}`; `hint()` -> `{from, to?}` staged hints; `reset()`; also `nextPuzzle(progress, filter)` picks the next unsolved puzzle near the user's rating.

## GUI pages (hash router, GUI worker)
Home, Play (vs bot: color choice, difficulty, optional clock, undo, hint, resign, draw offer, move list, captured pieces, eval bar optional, flip board, promotion dialog, game-over dialog), Local 2-player, Puzzles (list/filter + solve view), Saved Games (list, load, delete, rename, import/export file, PGN copy), Analysis (load game or FEN, step through moves, engine eval), Settings (theme, piece set, board style, sound, toggles), Learn/About (rules summary, notation guide, shortcuts). The visual style is ornate: gilded frames and filigree corners, engraved serif headings, deep ebony/ivory/gold palette, marble or walnut boards, a cartouche title, decorative dividers, subtle texture, all built with inline SVG and CSS (no external fonts or network; use a system serif stack). UI copy must be objective, complete sentences, no punchy fragments or dramatic flair. Keyboard accessible, screen reader labels on squares, drag and click-to-move both work, touch works.
