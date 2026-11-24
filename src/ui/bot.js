// Client for the engine Web Worker (src/ai-worker.js). Searches run off the
// main thread. Cancelling terminates the worker so that a long search stops
// immediately, and a fresh worker is created for the next request. If the
// worker cannot start, the client falls back to ai.js on the main thread.
import { mods } from './modules.js';

export class BotClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
    this.fallback = false;
    this.busyListeners = new Set();
  }

  onBusy(fn) { this.busyListeners.add(fn); return () => this.busyListeners.delete(fn); }
  emitBusy() { const b = this.pending.size > 0; this.busyListeners.forEach((f) => f(b)); }
  get busy() { return this.pending.size > 0; }

  ensureWorker() {
    if (this.worker || this.fallback) return;
    try {
      this.worker = new Worker(new URL('../ai-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.handle(e.data);
      this.worker.onerror = (e) => {
        console.warn('[bot] worker error, using the main thread instead:', e.message || e);
        e.preventDefault && e.preventDefault();
        this.failWorker();
      };
      this.worker.onmessageerror = () => this.failWorker();
    } catch (err) {
      console.warn('[bot] worker unavailable:', err.message);
      this.fallback = true;
    }
  }

  failWorker() {
    if (this.worker) { try { this.worker.terminate(); } catch { /* ignore */ } }
    this.worker = null; this.fallback = true;
    const reqs = Array.from(this.pending.values());
    this.pending.clear();
    for (const r of reqs) this.runFallback(r);
  }

  handle(msg) {
    const r = this.pending.get(msg && msg.id); if (!r) return;
    this.pending.delete(msg.id); this.emitBusy();
    if (msg.ok) r.resolve(msg.result); else r.reject(new Error(msg.error || 'The engine reported an error.'));
  }

  request(type, position, historyFens, options) {
    this.ensureWorker();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const r = { id, type, fen: position.toFen(), historyFens, options, resolve, reject };
      this.pending.set(id, r); this.emitBusy();
      if (this.fallback) this.runFallback(r);
      else this.worker.postMessage({ id, type, fen: r.fen, historyFens, options });
    });
  }

  async runFallback(r) {
    this.pending.set(r.id, r); this.emitBusy();
    await new Promise((res) => setTimeout(res, 30));
    if (!this.pending.has(r.id)) return;
    try {
      const { Position } = mods.engine; const ai = mods.ai;
      const pos = Position.fromFen(r.fen);
      const toUci = (m) => (m && typeof m === 'object' ? pos.moveToUci(m) : m);
      let result;
      if (r.type === 'choose') {
        const history = (r.historyFens || []).map((f) => Position.fromFen(f));
        const out = await ai.chooseMove(pos, { ...r.options, history });
        result = { ...out, move: toUci(out.move), pv: (out.pv || []).map((m, i) => (i === 0 ? toUci(m) : (typeof m === 'string' ? m : null))).filter(Boolean) };
      } else {
        const lines = await ai.analyze(pos, r.options || {});
        result = lines.map((l) => ({ ...l, move: toUci(l.move), pv: [toUci(l.move)] }));
      }
      if (!this.pending.has(r.id)) return;
      this.pending.delete(r.id); this.emitBusy(); r.resolve(result);
    } catch (err) {
      if (!this.pending.has(r.id)) return;
      this.pending.delete(r.id); this.emitBusy(); r.reject(err);
    }
  }

  // Resolves to {move, score, depth, nodes, pv} with move objects for `position`.
  async choose(position, historyPositions, options) {
    const res = await this.request('choose', position, historyPositions.map((p) => p.toFen()), options);
    return { ...res, move: position.parseUci(res.move), pvUci: res.pv || [] };
  }

  async analyze(position, options) {
    const res = await this.request('analyze', position, [], options);
    return (res || []).map((l) => ({ ...l, move: position.parseUci(l.move), pvUci: l.pv || [] })).filter((l) => l.move);
  }

  cancel() {
    if (!this.pending.size) return;
    const reqs = Array.from(this.pending.values());
    this.pending.clear();
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    for (const r of reqs) r.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    this.emitBusy();
  }
}

export const bot = new BotClient();
