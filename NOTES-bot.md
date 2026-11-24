# Bot worker notes

## Files owned
- `src/ai.js` — search, evaluation, difficulties, opening book, analyze
- `src/ai-worker.js` — module worker protocol
- `tests/ai.test.mjs` — Node test suite
- `NOTES-bot.md` — this file

## Engine internals used (from NOTES / exports)
Uses public contract API plus Engine’s documented faster surface:
- `Board` make/unmake, `makeNull`/`unmakeNull`, `legalCodes`, `zobrist`/`hashLo`/`hashHi`
- `Position.toBoard()`, `codeToMove()`, encoded-move helpers (`codeToUci`, flags)
- `TABLES` for mobility rays

No other worker’s files were edited.

## Search
Iterative deepening alpha-beta with:
- Principal variation search (PVS)
- Transposition table keyed by Zobrist (`hashHi`/`hashLo`), 2^20 slots
- Quiescence search with delta pruning (`legalCodes(true)` captures/promotions)
- MVV-LVA, killer moves, history heuristic
- Null-move pruning via `Board.makeNull` (R=2/3)
- Late move reductions on quiet late moves
- Check extensions (+1 depth when in check)
- Aspiration windows (±40 cp after depth 3)
- Time-aware stop (every 2048 nodes; stop next iteration when remaining < 40% of elapsed)
- Abort via `options.signal` (AbortController)

## Evaluation (centipawns, White’s view)
- Material + piece-square tables, tapered middlegame/endgame by phase
- Mobility (N/B/R/Q)
- Pawn structure: doubled, isolated, passed
- King safety (nearby enemies, pawn shield, open files)
- Rook on open / semi-open files
- Bishop pair
- Mate / stalemate / insufficient / fifty-move terminals
- Repetition awareness via `options.history` Zobrist keys (draw score on repeat)

## Difficulties
| id   | name         | Elo  | depth | timeMs | blunder | randomness |
|------|--------------|------|-------|--------|---------|------------|
| lvl1 | Novice       | 400  | 1     | 80     | 0.45    | 180        |
| lvl2 | Beginner     | 700  | 2     | 150    | 0.28    | 120        |
| lvl3 | Casual       | 1000 | 3     | 250    | 0.16    | 70         |
| lvl4 | Club Player  | 1300 | 4     | 400    | 0.08    | 40         |
| lvl5 | Advanced     | 1600 | 5     | 700    | 0.04    | 22         |
| lvl6 | Expert       | 1900 | 6     | 1100   | 0.015   | 12         |
| lvl7 | Master       | 2200 | 8     | 1800   | 0.005   | 6          |
| lvl8 | Grandmaster  | 2500 | 12    | 3000   | 0       | 0          |

Weakness model: limited depth + randomness window + blunderRate picking suboptimal but filtered moves. From lvl3 up, hanging-queen-for-nothing moves are filtered. Levels above lvl2 always take mate-in-one. Opening book (~32 UCI lines) used from lvl3 when `history.length < 12`, with random variety among matching continuations. Elite levels (lvl7+) do not inject blunders after search.

## Calibration (self-play, 2026-11-09 America/New_York)
Method: 4 games per pair (colors alternated) from start + two midgames; book disabled after ply pad except early start games; adjudicate unfinished games by eval ±200. Elo labels are approximate online-rapid anchors; **strength ordering is enforced by match results**.

| Match        | Higher wins | Lower wins | Draws | Monotonic |
|--------------|-------------|------------|-------|-----------|
| lvl3 vs lvl1 | 4           | 0          | 0     | yes       |
| lvl4 vs lvl2 | 4           | 0          | 0     | yes       |
| lvl5 vs lvl3 | 2           | 0          | 2     | yes       |
| lvl6 vs lvl4 | 1           | 0          | 3     | yes       |
| lvl7 vs lvl5 | 2           | 0          | 2     | yes       |
| lvl6 vs lvl2 | 4           | 0          | 0     | yes       |

Additional unit check: lvl6 move quality ≥ lvl2 on 6/6 referee positions; lvl6 as White converts Q+K vs lvl2 (3/3).

## Nodes/sec
Measured with `_benchmarkNps` (iterative deepening, 500ms):
- Start position: **~634k nps** (depth 10, ~249k nodes)
- Midgame: **~495k nps** (depth 7, ~248k nodes)

## Worker protocol
Inbound: `{id, type:'choose'|'analyze'|'abort'|'difficulties', fen, historyFens, options}`
Outbound: `{id, ok, result}` with UCI move strings; `abort` cancels AbortController for `targetId`/`id`.

## Tests
`node tests/ai.test.mjs` — 148 assertions, 0 failures (legal moves, mate-in-1/2 progress, no stalemate when winning, time limits, monotonicity, analyze multiPv, 200 random positions, NPS).

## Contract notes
- Public API matches CONTRACT.md (`DIFFICULTIES`, `chooseMove`, `evaluate`, `analyze`).
- No Page writes; no edits outside owned files.
