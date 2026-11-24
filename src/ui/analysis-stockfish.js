// Stockfish evaluation for the analysis board. Replaces the built-in bot
// engine's eval bar and line list while an analysis controller is mounted.
import { StockfishEngine } from './stockfish-client.js';
import { toCp } from '../puzzle-verify.js';

const ANALYSE_DEPTH = 14;

function stmScore(line) {
  if (!line) return 0;
  if (line.kind === 'mate') {
    if (line.value === 0) return -30000;
    return (line.value > 0 ? 1 : -1) * (30000 - Math.abs(line.value));
  }
  return typeof line.value === 'number' ? line.value : toCp(line);
}

function toLine(pos, raw) {
  if (!raw || !raw.move) return null;
  const move = pos.parseUci(raw.move);
  if (!move) return null;
  const pvUci = Array.isArray(raw.pv) && raw.pv.length ? raw.pv : [raw.move];
  return { move, score: stmScore(raw), pvUci };
}

/**
 * Hook Stockfish into a GameController that is already in analysis mode.
 * Returns a function that restores the original evaluator and stops the engine.
 */
export function attachStockfishEval(ctrl) {
  if (!ctrl || ctrl._sfEval) return () => {};
  const engine = new StockfishEngine();
  const original = ctrl.refreshEval.bind(ctrl);
  let token = 0;
  let dead = false;

  ctrl.refreshEval = async function refreshStockfishEval() {
    if (dead || !this.root) return;
    const pos = this.position;
    const mine = ++token;
    if (pos.legalMoves().length === 0) {
      this.evalScore = pos.isCheckmate() ? (pos.turn === 'w' ? -30000 : 30000) : 0;
      this.analysisLines = [];
      this.renderEval();
      this.renderLines([]);
      return;
    }
    this.evalScore = this.evalScore == null ? null : this.evalScore;
    try {
      const raw = await engine.analyse(pos.toFen(), { depth: ANALYSE_DEPTH, multipv: Math.min(3, pos.legalMoves().length) });
      if (dead || mine !== token || !this.root) return;
      const lines = raw.map((r) => toLine(pos, r)).filter(Boolean);
      if (!lines.length) return;
      this.evalScore = pos.turn === 'w' ? lines[0].score : -lines[0].score;
      this.analysisLines = lines;
      this.renderEval();
      this.renderLines(lines);
    } catch (err) {
      if (!dead && mine === token) console.warn('[stockfish-eval]', err && err.message ? err.message : err);
    }
  };

  ctrl._sfEval = { engine, original };
  ctrl.refreshEval();

  return () => {
    dead = true;
    token++;
    try { engine.terminate(); } catch { /* already gone */ }
    if (ctrl.refreshEval !== original && ctrl._sfEval && ctrl._sfEval.engine === engine) {
      ctrl.refreshEval = original;
      delete ctrl._sfEval;
    }
  };
}
