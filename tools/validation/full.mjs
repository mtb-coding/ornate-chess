import fs from 'fs';
import { createNodeEngine } from '/workspace/chess/tests/node-stockfish.mjs';
import { Position } from '/workspace/chess/src/engine.js';
import { toCp } from '/workspace/chess/src/puzzle-verify.js';
const [shard, n] = [+process.argv[2], +process.argv[3]];
const all = JSON.parse(fs.readFileSync('/tmp/val/all.json')).map(x => x.p).filter(p => !p.mateIn).filter((_, i) => i % n === shard);
const e = createNodeEngine('/workspace/rb-chess-review/tools/node_modules/stockfish/bin/stockfish-19-single.js', { hash: 64 });
const out = [];
for (const p of all) {
  let pos = Position.fromFen(p.fen); const steps = [];
  for (let i = 0; i < p.solution.length; i++) {
    const mv = pos.parseUci(p.solution[i]);
    if (i % 2 === 0) { const an = await e.analyse(pos.toFen(), { depth: 15, multipv: 4 }); steps.push({ i, fen: pos.toFen(), sol: p.solution[i], lines: an }); }
    pos = pos.makeMove(mv);
  }
  out.push({ code: p.code, level: p.level, steps });
}
fs.writeFileSync(`/tmp/val/full-${shard}.json`, JSON.stringify(out)); console.error('done', shard, out.length);
e.quit();
