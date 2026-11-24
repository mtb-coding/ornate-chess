import fs from 'fs';
import { createNodeEngine } from '/workspace/chess/tests/node-stockfish.mjs';
import { generatePuzzle } from '/workspace/chess/src/puzzle-gen.js';
const [level, count, base, shard] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
const e = createNodeEngine(); const out = [];
for (let i = 0; i < count; i++) {
  const r = await generatePuzzle({ seed: (base + i * 7919 + 13) >>> 0, level, engine: e, maxGames: 600, timeBudgetMs: 300000 });
  if (r.puzzle) out.push({ p: r.puzzle, genLevel: level, ms: r.puzzle.generatedMs, games: r.puzzle.games }); else out.push({ p: null, genLevel: level, ms: null });
  fs.writeFileSync(`/tmp/val/batch-${level}-${shard}.json`, JSON.stringify(out.filter(x => x.p)));
  fs.writeFileSync(`/tmp/val/times-${level}-${shard}.json`, JSON.stringify(out.map(x => ({ level, ms: x.ms, games: x.games, found: !!x.p }))));
}
e.quit();
