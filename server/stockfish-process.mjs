// Runs the bundled Stockfish build as a child process on this machine.
// The object has the same analyse() method as the engine used in the page.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/vendor/stockfish/stockfish-19-lite-single.js');

export function createNodeEngine(script = BUNDLED, { hash = 16 } = {}) {
  const proc = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  let handler = null;
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (handler) handler(line);
    }
  });
  const send = (command) => proc.stdin.write(command + '\n');
  send('uci');
  send(`setoption name Hash value ${hash}`);
  let queue = Promise.resolve();
  const analyse = (fen, { depth = 16, multipv = 2 } = {}) => {
    const run = () => new Promise((resolve) => {
      const best = {};
      handler = (line) => {
        if (line.startsWith('info') && line.includes(' pv ') && line.includes(' multipv ')) {
          if (/ (lowerbound|upperbound)\b/.test(line)) return;
          const mp = +line.match(/ multipv (\d+)/)[1];
          const depthMatch = line.match(/ depth (\d+)/);
          const seen = depthMatch ? +depthMatch[1] : 0;
          const score = line.match(/ score (cp|mate) (-?\d+)/);
          if (score && !(best[mp] && best[mp].depth > seen)) {
            const pv = line.split(' pv ')[1].trim().split(/\s+/);
            best[mp] = { move: pv[0], kind: score[1], value: +score[2], pv, depth: seen };
          }
        } else if (line.startsWith('bestmove')) {
          handler = null;
          resolve(Object.keys(best).sort((a, b) => a - b).map((key) => best[key]));
        }
      };
      send(`setoption name MultiPV value ${multipv}`);
      send(`position fen ${fen}`);
      send(`go depth ${depth}`);
    });
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  };
  return { analyse, quit() { proc.kill(); } };
}
