// Thin UCI wrapper around the bundled Stockfish web worker (src/vendor/stockfish).
// Requests are queued and answered one at a time. The engine is started on the
// first request, and every request ends with an error after a timeout.
// Used by the page (puzzle-gen-client.js) and never by the game itself.
const ENGINE_URL = new URL('../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url);
const START_TIMEOUT_MS = 30000;
const ANALYSE_TIMEOUT_MS = 60000;

export class StockfishEngine {
  constructor(url = ENGINE_URL) {
    this.url = url;
    this.worker = null;
    this.handler = null;
    this.queue = Promise.resolve();
    this.started = null;
    this.dead = false;
  }

  start() {
    if (this.started) return this.started;
    this.started = new Promise((resolve, reject) => {
      let timer;
      const fail = (msg) => { clearTimeout(timer); this.dead = true; this.terminate(); reject(new Error(msg)); };
      try {
        this.worker = new Worker(this.url);
      } catch (err) { fail(`The engine could not be started: ${err.message || err}`); return; }
      this.worker.onerror = (ev) => {
        const msg = `The engine failed to load: ${ev && ev.message ? ev.message : 'unknown error'}`;
        if (this.handler) { const h = this.handler; this.handler = null; h({ error: msg }); }
        fail(msg);
      };
      this.worker.onmessage = (ev) => { if (this.handler) this.handler(typeof ev.data === 'string' ? ev.data : ''); };
      timer = setTimeout(() => fail('The engine did not start in time.'), START_TIMEOUT_MS);
      let step = 0;
      this.handler = (line) => {
        if (line && line.error) return;
        if (line === 'uciok' && step === 0) { step = 1; this.send('setoption name Hash value 8'); this.send('isready'); }
        else if (line === 'readyok' && step === 1) { clearTimeout(timer); this.handler = null; resolve(); }
      };
      this.send('uci');
    });
    return this.started;
  }

  send(cmd) { if (this.worker) this.worker.postMessage(cmd); }

  /** Analyse a position. Resolves with [{ move, kind, value, pv }] from best to worst. */
  analyse(fen, { depth = 16, multipv = 2, timeMs } = {}) {
    const run = () => this.start().then(() => new Promise((resolve, reject) => {
      if (this.dead) { reject(new Error('The engine is not available.')); return; }
      const best = {};
      const timer = setTimeout(() => { this.handler = null; this.send('stop'); reject(new Error('The engine did not answer in time.')); }, ANALYSE_TIMEOUT_MS);
      this.handler = (line) => {
        if (line && line.error) { clearTimeout(timer); this.handler = null; reject(new Error(line.error)); return; }
        if (line.startsWith('info') && line.includes(' pv ') && line.includes(' multipv ')) {
          // Bound scores come from an aspiration window that failed high or
          // low; they are not exact and are replaced by the exact line of
          // the same depth. A line never replaces one from a deeper iteration.
          if (/ (lowerbound|upperbound)\b/.test(line)) return;
          const mp = +line.match(/ multipv (\d+)/)[1];
          const dm = line.match(/ depth (\d+)/);
          const d = dm ? +dm[1] : 0;
          const sc = line.match(/ score (cp|mate) (-?\d+)/);
          if (sc && !(best[mp] && best[mp].depth > d)) {
            const pv = line.split(' pv ')[1].trim().split(/\s+/);
            best[mp] = { move: pv[0], kind: sc[1], value: +sc[2], pv, depth: d };
          }
        } else if (line.startsWith('bestmove')) {
          clearTimeout(timer); this.handler = null;
          const bm = line.split(/\s+/)[1];
          if (!best[1] && bm && bm !== '(none)') best[1] = { move: bm, kind: 'cp', value: 0, pv: [bm] };
          resolve(Object.keys(best).sort((a, b) => a - b).map((k) => best[k]));
        }
      };
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      this.send(timeMs ? `go movetime ${Math.max(50, timeMs | 0)}` : `go depth ${depth}`);
    }));
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  terminate() {
    if (this.worker) { try { this.worker.terminate(); } catch { /* already gone */ } }
    this.worker = null;
    this.handler = null;
  }
}
