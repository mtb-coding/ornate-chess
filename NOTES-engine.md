# Engine notes (src/engine.js)

All contract names are implemented unchanged. Run tests: `node tests/engine.test.mjs` (`--quick` skips perft above 1M nodes).

## Behaviour details other workers should know
- Move objects: `{from, to, piece, color, captured, flags, promotion?}`. `color` is extra. `promotion` is omitted (not `undefined`-valued) for non-promotions.
- Anything that takes a move (`makeMove`, `toSan`, `Game.play`) accepts a move object (only `from`, `to`, optional `promotion` are read; squares may be numbers or 'e4' strings), a UCI string, a SAN string, or an internal move code. A promotion move without `promotion` defaults to a queen.
- `Position.makeMove` throws on an illegal move; `Game.play` returns false instead.
- `Position.board` and `castling` are frozen, cached objects; `board[i]` pieces are shared frozen `{color,type}` objects (do not mutate).
- FEN parsing throws `Error('Invalid FEN: ...')` with a readable message. Castling rights inconsistent with king/rook placement and impossible ep squares are silently dropped, so `toFen()` may normalize such input.
- `parseUci` also accepts king-takes-own-rook castling (`e1h1`). `parseSan` tolerates `0-0`, missing `=` (`e8Q`), over-disambiguation (`Ng1f3`), long algebraic (`e2-e4`), annotations (`!?`) and `e.p.`.
- Game model: one main line plus a cursor. `moves`/`sans`/`positions` are up to the cursor; `line`, `lineSans`, `linePositions`, `ply`, `length` cover the whole line. `undo`/`redo`/`goto` only move the cursor; `play` at an earlier cursor truncates the rest (clears redo). All return booleans.
- `result()` is evaluated at the cursor. Threefold, fifty-move, insufficient material, stalemate and checkmate are automatic and make `play` return false. `resign/drawByAgreement/timeout` return false if the game is already over; they truncate any redo moves and are tied to the current ply (undo then redo shows the result again). `timeout(color)` is a draw if the winner has only a king or the material is insufficient.
- `Game` also has `headers`, `comments` (ply -> text; 0 = before move 1) and `nags` (ply -> [n]), `playSan`, `playUci`, `turn`, `lastMove`, `fen()`, `canUndo()`, `canRedo()`, `repetitionCount()`, `isGameOver()`, `resultInfo`.
- `toPgn()` exports the whole line (not just up to the cursor) with the Seven Tag Roster first, game `headers` merged with the argument, SetUp/FEN when needed, comments and NAGs, 80-column wrap. `fromPgn` reads the first game in the text; use `splitPgnGames(text)` for multi-game files. Variations are skipped. A decisive/draw result token that the final position does not explain becomes `resignation`/`agreement`, or `timeout` when the Termination header mentions time/forfeit. Errors: `Illegal or unreadable move "X" at move N (...)`.
- `toJSON()` = `{version:1, startFen, uci, resultInfo}` where `resultInfo` is `null` or `{result, reason, ply}`; optional extra keys only when non-default: `ply` (cursor if not at the end), `headers`, `comments`, `nags`. `fromJSON` accepts the object or a JSON string and throws readable errors. Validators in storage.js should require only the four contract keys and allow the optional ones.

## Extra exports (for the bot and others)
- `Board`: mutable mailbox board for search. Get one with `position.toBoard()` (a copy) or `Board.fromFen(fen)`.
  - fields: `sq` (Int8Array(64), code = type | 8*black; types PAWN=1 KNIGHT=2 BISHOP=3 ROOK=4 QUEEN=5 KING=6), `side` (0 white / 1 black), `castle` bitmask (1 wK, 2 wQ, 4 bK, 8 bQ), `ep` (-1 none), `halfmove`, `fullmove`, `kings[2]`, `hashLo`/`hashHi` (incremental Zobrist, int32s), getter `zobrist` (number < 2^53, good TT key).
  - `legalCodes(capturesOnly=false)` -> int[] legal moves; `genPseudo(list, capturesOnly)` pseudo-legal (castling already checked for attacked squares), filter with `isLegal(code)`; `make(code)` / `unmake(code)` (must be called in LIFO order with the same code); `makeNull()` / `unmakeNull()`; `inCheck()`; `isAttacked(sq, byColor0or1)`; `toFen()`; `clone()`; `computeHash()`.
  - capturesOnly also returns quiet promotions.
- Move code helpers: `encodeMove(from,to,promo,flags)`, `moveFrom`, `moveTo`, `movePromo`, `moveFlags`, flag bits `F_CAPTURE F_EP F_KSIDE F_QSIDE F_PROMO F_DOUBLE`, `codeToUci(code)`; `position.legalCodes()`, `position.codeToMove(code)`; `position.moveCode(anyMove)` -> code or -1. `Position.fromBoard(board)` wraps a copy of a Board.
- Piece constants `EMPTY PAWN KNIGHT BISHOP ROOK QUEEN KING BLACK`, `TYPE_CHARS`, `TABLES` {KNIGHT, KING, PAWN_ATTACKS[color], RAYS[dir]} (dirs 0-3 orthogonal, 4-7 diagonal).
- `perftDivide(position, depth)`, `squareName(sq)`, `parseSquare('e4')`, `moveToUci(move)`, `parsePgn(text)` -> `{headers, items, result}`, `splitPgnGames(text)`.
- Position extras: `pieceAt(sq)`, `kingSquare(color)`, `isAttacked(sq, color)`, `isCheck()`, `isGameOver()`, `isLegal(move)`, `zobrist`, `toBoard()`.
- `perft()` also accepts a FEN string or a Board.

## Performance (Node 24, this box)
Kiwipete perft 4 ~0.34 s, start perft 5 ~0.42 s, full engine test file ~1.2 s. Legality uses make/test/unmake.

## Note on the brief
The brief's perft "position 4" FEN (`.../nPP5/BB2P3/...`) is a typo; the standard CPW position 4 is `r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1`, which gives 6/264/9467/422333 and is what the tests use (plus its mirror).
