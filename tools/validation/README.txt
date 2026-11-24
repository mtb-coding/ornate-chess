Scripts used to measure generated puzzles against an independent Stockfish run.
gen-batch.mjs <level> <count> <baseSeed> <shard>   generates puzzles with the in-app check, writes /tmp/val/batch-*.json
full.mjs <shard> <shards>                            analyses every solver step with the full Stockfish 19 network (depth 15, four lines)
score-full.mjs                                       counts steps where a second move is within 150 centipawns and above +200, or the best move differs
The paths inside the scripts point at /tmp/val and at a Stockfish package in node_modules; adjust them before use.
