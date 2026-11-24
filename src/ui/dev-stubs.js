// Development stubs for the GUI. They follow CONTRACT.md closely enough to
// exercise the interface, and they are loaded only when a real module fails
// to import (see modules.js). They are never the default.

// ---------------------------------------------------------------- engine
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const FILES = 'abcdefgh';
const sqName = (s) => FILES[s & 7] + ((s >> 3) + 1);
const sqParse = (n) => FILES.indexOf(n[0]) + 8 * (parseInt(n[1], 10) - 1);
const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1);

class Position {
  constructor() { this.board = new Array(64).fill(null); this.turn = 'w'; this.castling = { wK: false, wQ: false, bK: false, bQ: false }; this.epSquare = null; this.halfmove = 0; this.fullmove = 1; }
  static fromFen(fen) {
    const p = new Position(); const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split('/'); if (rows.length !== 8) throw new Error('Invalid FEN');
    rows.forEach((row, i) => { let f = 0; const r = 7 - i; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { const color = ch === ch.toUpperCase() ? 'w' : 'b'; p.board[r * 8 + f] = { color, type: ch.toLowerCase() }; f++; } } });
    p.turn = parts[1] || 'w'; const c = parts[2] || '-';
    p.castling = { wK: c.includes('K'), wQ: c.includes('Q'), bK: c.includes('k'), bQ: c.includes('q') };
    p.epSquare = parts[3] && parts[3] !== '-' ? sqParse(parts[3]) : null;
    p.halfmove = +(parts[4] || 0); p.fullmove = +(parts[5] || 1); return p;
  }
  toFen() {
    let s = ''; for (let r = 7; r >= 0; r--) { let e = 0; for (let f = 0; f < 8; f++) { const pc = this.board[r * 8 + f]; if (!pc) { e++; continue; } if (e) { s += e; e = 0; } s += pc.color === 'w' ? pc.type.toUpperCase() : pc.type; } if (e) s += e; if (r) s += '/'; }
    const c = (this.castling.wK ? 'K' : '') + (this.castling.wQ ? 'Q' : '') + (this.castling.bK ? 'k' : '') + (this.castling.bQ ? 'q' : '') || '-';
    return `${s} ${this.turn} ${c} ${this.epSquare == null ? '-' : sqName(this.epSquare)} ${this.halfmove} ${this.fullmove}`;
  }
  clone() { const p = new Position(); p.board = this.board.slice(); p.turn = this.turn; p.castling = { ...this.castling }; p.epSquare = this.epSquare; p.halfmove = this.halfmove; p.fullmove = this.fullmove; return p; }
  attacked(sq, by) {
    const f = sq & 7, r = sq >> 3, B = this.board;
    const is = (s, types) => s >= 0 && B[s] && B[s].color === by && types.includes(B[s].type);
    const dir = by === 'w' ? -1 : 1;
    if (is(at(f - 1, r + dir), 'p') || is(at(f + 1, r + dir), 'p')) return true;
    for (const [a, b] of KN) if (is(at(f + a, r + b), 'n')) return true;
    for (const [a, b] of KG) if (is(at(f + a, r + b), 'k')) return true;
    for (const [ds, t] of [[DIAG, 'bq'], [ORTH, 'rq']]) for (const [a, b] of ds) { let x = f + a, y = r + b; while (at(x, y) >= 0) { const s = at(x, y); if (B[s]) { if (is(s, t)) return true; break; } x += a; y += b; } }
    return false;
  }
  kingSq(color) { return this.board.findIndex((p) => p && p.type === 'k' && p.color === color); }
  inCheck() { return this.attacked(this.kingSq(this.turn), this.turn === 'w' ? 'b' : 'w'); }
  pseudo() {
    const out = [], B = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
    const add = (from, to, flags = '') => { const piece = B[from].type; const captured = flags.includes('e') ? 'p' : B[to] ? B[to].type : null; if (captured && !flags.includes('c')) flags += 'c'; if (piece === 'p' && (to >> 3 === 7 || to >> 3 === 0)) { for (const pr of 'qrbn') out.push({ from, to, piece, captured, promotion: pr, flags: flags + 'p' }); } else out.push({ from, to, piece, captured, promotion: undefined, flags }); };
    for (let s = 0; s < 64; s++) {
      const pc = B[s]; if (!pc || pc.color !== us) continue; const f = s & 7, r = s >> 3;
      if (pc.type === 'p') {
        const d = us === 'w' ? 1 : -1, one = at(f, r + d);
        if (one >= 0 && !B[one]) { add(s, one); const start = us === 'w' ? 1 : 6; const two = at(f, r + 2 * d); if (r === start && !B[two]) add(s, two, 'd'); }
        for (const df of [-1, 1]) { const t = at(f + df, r + d); if (t < 0) continue; if (B[t] && B[t].color === them) add(s, t, 'c'); else if (t === this.epSquare) add(s, t, 'ce'); }
      } else if (pc.type === 'n' || pc.type === 'k') {
        for (const [a, b] of pc.type === 'n' ? KN : KG) { const t = at(f + a, r + b); if (t >= 0 && (!B[t] || B[t].color === them)) add(s, t); }
        if (pc.type === 'k') {
          const home = us === 'w' ? 4 : 60;
          if (s === home && !this.attacked(s, them)) {
            if (this.castling[us + 'K'] && !B[s + 1] && !B[s + 2] && !this.attacked(s + 1, them) && !this.attacked(s + 2, them)) add(s, s + 2, 'k');
            if (this.castling[us + 'Q'] && !B[s - 1] && !B[s - 2] && !B[s - 3] && !this.attacked(s - 1, them) && !this.attacked(s - 2, them)) add(s, s - 2, 'q');
          }
        }
      } else {
        const ds = pc.type === 'b' ? DIAG : pc.type === 'r' ? ORTH : DIAG.concat(ORTH);
        for (const [a, b] of ds) { let x = f + a, y = r + b; while (at(x, y) >= 0) { const t = at(x, y); if (B[t]) { if (B[t].color === them) add(s, t); break; } add(s, t); x += a; y += b; } }
      }
    }
    return out;
  }
  legalMoves() { return this.pseudo().filter((m) => { const n = this.makeMove(m); return !n.attacked(n.kingSq(this.turn), n.turn); }); }
  legalMovesFrom(sq) { return this.legalMoves().filter((m) => m.from === sq); }
  makeMove(m) {
    const p = this.clone(), B = p.board, pc = B[m.from];
    B[m.to] = m.promotion ? { color: pc.color, type: m.promotion } : pc; B[m.from] = null;
    if (m.flags.includes('e')) B[m.to + (pc.color === 'w' ? -8 : 8)] = null;
    if (m.flags.includes('k')) { B[m.to - 1] = B[m.to + 1]; B[m.to + 1] = null; }
    if (m.flags.includes('q')) { B[m.to + 1] = B[m.to - 2]; B[m.to - 2] = null; }
    if (pc.type === 'k') { p.castling[pc.color + 'K'] = false; p.castling[pc.color + 'Q'] = false; }
    for (const [sq, key] of [[0, 'wQ'], [7, 'wK'], [56, 'bQ'], [63, 'bK']]) if (m.from === sq || m.to === sq) p.castling[key] = false;
    p.epSquare = m.flags.includes('d') ? (m.from + m.to) / 2 : null;
    p.halfmove = pc.type === 'p' || m.captured ? 0 : p.halfmove + 1;
    if (pc.color === 'b') p.fullmove++; p.turn = pc.color === 'w' ? 'b' : 'w'; return p;
  }
  isCheckmate() { return this.inCheck() && this.legalMoves().length === 0; }
  isStalemate() { return !this.inCheck() && this.legalMoves().length === 0; }
  isInsufficientMaterial() { const ps = this.board.filter((p) => p && p.type !== 'k'); return ps.length === 0 || (ps.length === 1 && 'nb'.includes(ps[0].type)); }
  isFiftyMoveDraw() { return this.halfmove >= 100; }
  hash() { return this.toFen().split(' ').slice(0, 4).join(' '); }
  toSan(m) {
    if (m.flags.includes('k')) return 'O-O' + this.suffix(m); if (m.flags.includes('q')) return 'O-O-O' + this.suffix(m);
    let s = '';
    if (m.piece === 'p') { if (m.captured) s = FILES[m.from & 7] + 'x'; s += sqName(m.to); if (m.promotion) s += '=' + m.promotion.toUpperCase(); }
    else {
      s = m.piece.toUpperCase();
      const others = this.legalMoves().filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
      if (others.length) { const sf = others.some((o) => (o.from & 7) === (m.from & 7)); const sr = others.some((o) => (o.from >> 3) === (m.from >> 3)); if (!sf) s += FILES[m.from & 7]; else if (!sr) s += (m.from >> 3) + 1; else s += sqName(m.from); }
      if (m.captured) s += 'x'; s += sqName(m.to);
    }
    return s + this.suffix(m);
  }
  suffix(m) { const n = this.makeMove(m); return n.isCheckmate() ? '#' : n.inCheck() ? '+' : ''; }
  parseSan(san) { const clean = san.replace(/[+#!?]/g, ''); return this.legalMoves().find((m) => this.toSan(m).replace(/[+#]/g, '') === clean) || null; }
  parseUci(u) { if (!u || u.length < 4) return null; const from = sqParse(u.slice(0, 2)), to = sqParse(u.slice(2, 4)), pr = u[4]; return this.legalMoves().find((m) => m.from === from && m.to === to && (m.promotion || undefined) === (pr || undefined)) || null; }
  moveToUci(m) { return sqName(m.from) + sqName(m.to) + (m.promotion || ''); }
}

class Game {
  constructor(startFen = START_FEN) { this.startFen = startFen; this.positions = [Position.fromFen(startFen)]; this.moves = []; this.sans = []; this.redoStack = []; this.resultInfo = null; this.ply = 0; this.allMoves = []; this.allSans = []; this.allPositions = this.positions; }
  get position() { return this.positions[this.positions.length - 1]; }
  play(move) {
    const pos = this.position; const legal = pos.legalMoves().find((m) => m.from === move.from && m.to === move.to && (m.promotion || undefined) === (move.promotion || undefined));
    if (!legal || this.result()) return false; this.sans.push(pos.toSan(legal)); this.moves.push(legal); this.positions.push(pos.makeMove(legal)); this.redoStack = []; return true;
  }
  undo() { if (!this.moves.length) return false; this.resultInfo = null; this.redoStack.push(this.moves.pop()); this.sans.pop(); this.positions.pop(); return true; }
  redo() { const m = this.redoStack.pop(); if (!m) return false; const r = this.redoStack; const ok = this.play(m); this.redoStack = r; return ok; }
  goto(ply) { while (this.moves.length > ply && this.undo()); while (this.moves.length < ply && this.redo()); }
  result() {
    if (this.resultInfo) return this.resultInfo; const p = this.position;
    if (p.isCheckmate()) return { result: p.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
    if (p.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
    if (p.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient' };
    if (p.isFiftyMoveDraw()) return { result: '1/2-1/2', reason: 'fifty-move' };
    const h = p.hash(); if (this.positions.filter((x) => x.hash() === h).length >= 3) return { result: '1/2-1/2', reason: 'threefold' };
    return null;
  }
  resign(color) { this.resultInfo = { result: color === 'w' ? '0-1' : '1-0', reason: 'resignation' }; }
  drawByAgreement() { this.resultInfo = { result: '1/2-1/2', reason: 'agreement' }; }
  timeout(color) { this.resultInfo = { result: color === 'w' ? '0-1' : '1-0', reason: 'timeout' }; }
  toPgn(headers = {}) {
    const res = this.result() ? this.result().result : '*'; const h = { Event: 'Casual game', Site: 'Ornate Chess', Result: res, ...headers };
    if (this.startFen !== START_FEN) { h.SetUp = '1'; h.FEN = this.startFen; }
    let body = ''; const start = this.positions[0];
    this.sans.forEach((s, i) => { const white = (start.turn === 'w') === (i % 2 === 0); const num = start.fullmove + Math.floor((i + (start.turn === 'b' ? 1 : 0)) / 2); if (white) body += `${num}. `; else if (i === 0) body += `${num}... `; body += s + ' '; });
    return Object.entries(h).map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n\n' + body + res + '\n';
  }
  static fromPgn(text) {
    const fen = (text.match(/\[FEN "([^"]+)"\]/) || [])[1]; const g = new Game(fen || START_FEN);
    let body = text.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, ' ');
    while (/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, ' ');
    for (const tok of body.split(/\s+/)) { if (!tok || /^\d+\.+$/.test(tok) || /^\$\d+$/.test(tok) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue; const t = tok.replace(/^\d+\.+/, ''); if (!t) continue; const m = g.position.parseSan(t); if (!m) throw new Error('Illegal move in PGN: ' + t); g.play(m); }
    return g;
  }
  toJSON() { return { version: 1, startFen: this.startFen, uci: this.moves.map((m) => this.positions[0].moveToUci(m)), resultInfo: this.resultInfo }; }
  static fromJSON(o) { const g = new Game(o.startFen || START_FEN); for (const u of o.uci || []) { const m = g.position.parseUci(u); if (!m) throw new Error('Bad move ' + u); g.play(m); } g.resultInfo = o.resultInfo || null; return g; }
}
function perft(pos, d) { if (!d) return 1; let n = 0; for (const m of pos.legalMoves()) n += perft(pos.makeMove(m), d - 1); return n; }
export const engine = { START_FEN, Position, Game, perft, PIECE_VALUES };

// ---------------------------------------------------------------- ai
const DIFFICULTIES = [
  ['lvl1', 'Novice', 400], ['lvl2', 'Beginner', 700], ['lvl3', 'Casual', 1000], ['lvl4', 'Club', 1300],
  ['lvl5', 'Strong club', 1600], ['lvl6', 'Expert', 1900], ['lvl7', 'Master', 2200], ['lvl8', 'Grandmaster', 2500],
].map(([id, name, elo], i) => ({ id, name, elo, depth: 1 + (i >> 1), timeMs: 300 + i * 300, blunderRate: Math.max(0, 0.4 - i * 0.06), randomness: Math.max(0, 80 - i * 12), description: `The ${name} level is a development stub that plays at roughly ${elo} rating.` }));
function evaluate(pos) { let s = 0; for (const p of pos.board) if (p) s += (p.color === 'w' ? 1 : -1) * PIECE_VALUES[p.type]; return s; }
function search(pos, d, a, b) { if (d === 0) return (pos.turn === 'w' ? 1 : -1) * evaluate(pos); const ms = pos.legalMoves(); if (!ms.length) return pos.inCheck() ? -99999 : 0; for (const m of ms) { const v = -search(pos.makeMove(m), d - 1, -b, -a); if (v > a) a = v; if (a >= b) break; } return a; }
function rank(pos, depth) { return pos.legalMoves().map((m) => ({ move: m, score: -search(pos.makeMove(m), depth - 1, -1e6, 1e6), pv: [m] })).sort((x, y) => y.score - x.score); }
async function chooseMove(pos, opts = {}) { const lv = DIFFICULTIES.find((d) => d.id === opts.difficultyId) || DIFFICULTIES[0]; const r = rank(pos, Math.min(2, lv.depth)); if (!r.length) return { move: null, score: 0, depth: 0, nodes: 0, pv: [] }; const pick = Math.random() < lv.blunderRate ? r[Math.floor(Math.random() * r.length)] : r[0]; return { ...pick, depth: 2, nodes: 0 }; }
async function analyze(pos, o = {}) { return rank(pos, 2).slice(0, o.multiPv || 1); }
export const ai = { DIFFICULTIES, chooseMove, evaluate, analyze };

// ---------------------------------------------------------------- storage
const mem = new Map();
const backend = (() => { try { const ls = globalThis.localStorage; ls.setItem('ornate-chess:probe', '1'); ls.removeItem('ornate-chess:probe'); return ls; } catch { return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }; } })();
const K = (k) => 'ornate-chess:' + k;
const rd = (k, d) => { try { const v = backend.getItem(K(k)); return v == null ? d : JSON.parse(v); } catch { return d; } };
const wr = (k, v) => backend.setItem(K(k), JSON.stringify(v));
const DEFAULTS = { theme: 'ebony', pieceSet: 'classic', boardStyle: 'marble', sound: true, showLegal: true, showCoords: true, autoQueen: false, animations: true, lastBotLevel: 'lvl4', hints: true };
export const storage = {
  saveGame(rec) { const games = rd('games', []); const id = rec.id || 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); const r = { ...rec, id, savedAt: rec.savedAt || Date.now() }; const i = games.findIndex((g) => g.id === id); if (i >= 0) games[i] = r; else games.unshift(r); wr('games', games); return id; },
  listGames() { return rd('games', []); }, loadGame(id) { return rd('games', []).find((g) => g.id === id) || null; },
  deleteGame(id) { wr('games', rd('games', []).filter((g) => g.id !== id)); }, renameGame(id, name) { wr('games', rd('games', []).map((g) => (g.id === id ? { ...g, name } : g))); },
  saveAutosave(r) { wr('autosave', r); }, loadAutosave() { return rd('autosave', null); }, clearAutosave() { backend.removeItem(K('autosave')); },
  exportGameFile(r) { return JSON.stringify({ format: 'ornate-chess', ...r }, null, 2); },
  importGameFile(text) { let o; try { o = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); } if (!o.game || !Array.isArray(o.game.uci)) throw new Error('The file does not contain a saved game.'); Game.fromJSON(o.game); delete o.id; return o; },
  exportPgn(r) { return Game.fromJSON(r.game).toPgn({ Event: r.name }); },
  importPgn(text) { const g = Game.fromPgn(text); return { name: (text.match(/\[Event "([^"]+)"\]/) || [])[1] || 'Imported game', savedAt: Date.now(), mode: 'analysis', game: g.toJSON() }; },
  getSettings() { return { ...DEFAULTS, ...rd('settings', {}) }; }, setSettings(p) { const s = { ...this.getSettings(), ...p }; wr('settings', s); return s; },
  recordResult({ mode, botLevel, playerColor, result }) { const st = rd('stats', { byLevel: {}, totals: { wins: 0, losses: 0, draws: 0, games: 0 } }); const k = botLevel || mode || 'unknown'; const e = st.byLevel[k] || { wins: 0, losses: 0, draws: 0, games: 0 }; const o = result === '1/2-1/2' ? 'draws' : (result === '1-0') === (playerColor === 'w') ? 'wins' : 'losses'; e[o]++; e.games++; st.totals[o]++; st.totals.games++; st.byLevel[k] = e; wr('stats', st); return st; },
  getStats() { return rd('stats', { byLevel: {}, totals: { wins: 0, losses: 0, draws: 0, games: 0 } }); },
  getPuzzleProgress() { return rd('puzzle-progress', { rating: 1200, puzzles: {} }); },
  markPuzzle(id, o) { const p = this.getPuzzleProgress(); const prev = p.puzzles[id] || {}; p.puzzles[id] = { ...prev, solved: !!(prev.solved || o.solved), attempts: (prev.attempts || 0) + 1, usedHint: !!(prev.usedHint || o.usedHint), lastAt: Date.now() }; if (!prev.solved) p.rating += o.solved ? 12 : -12; wr('puzzle-progress', p); return p; },
  getRating() { return this.getPuzzleProgress().rating; },
  getOnlineRatings() { return rd('online-ratings', null) || { version: 1, bullet: { rating: 1500, deviation: 350, games: 0, wins: 0, draws: 0, losses: 0, peak: 1500, provisional: true, history: [], white: { wins: 0, draws: 0, losses: 0, games: 0 }, black: { wins: 0, draws: 0, losses: 0, games: 0 } }, blitz: { rating: 1500, deviation: 350, games: 0, wins: 0, draws: 0, losses: 0, peak: 1500, provisional: true, history: [], white: { wins: 0, draws: 0, losses: 0, games: 0 }, black: { wins: 0, draws: 0, losses: 0, games: 0 } }, rapid: { rating: 1500, deviation: 350, games: 0, wins: 0, draws: 0, losses: 0, peak: 1500, provisional: true, history: [], white: { wins: 0, draws: 0, losses: 0, games: 0 }, black: { wins: 0, draws: 0, losses: 0, games: 0 } } }; },
  setOnlineRatings(doc) { wr('online-ratings', doc); return doc; },
  getPlayerRating() { const d = rd('player-rating', null) || { rating: 1200, games: 0, wins: 0, draws: 0, losses: 0, peak: 1200, history: [] }; return { ...d, provisional: d.games < 10 }; },
  recordRatedGame({ botLevel, opponent, score }) { const d = this.getPlayerRating(); delete d.provisional; const k = d.games < 20 ? 40 : 20; const before = d.rating; const after = Math.round(before + k * (score - 1 / (1 + 10 ** ((opponent - before) / 400)))); d.rating = after; d.games++; d[score === 1 ? 'wins' : score === 0 ? 'losses' : 'draws']++; d.peak = Math.max(d.peak, after); d.history.push({ at: Date.now(), rating: after, delta: after - before, opponent, botLevel, score }); wr('player-rating', d); return { before, after, delta: after - before, k, games: d.games, provisional: d.games < 10, data: d }; },
  resetPlayerRating() { backend.removeItem(K('player-rating')); return this.getPlayerRating(); },
};

// ---------------------------------------------------------------- puzzles
const PUZZLES = [
  { id: 'stub1', title: 'Back rank mate with the rook', theme: 'back-rank', difficulty: 1, rating: 800, fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', solution: ['a1a8'], hint: 'Look at the eighth rank.', explanation: 'The rook delivers mate on a8 because the pawns block the king.' },
  { id: 'stub2', title: 'Queen mate next to the king', theme: 'mate-in-1', difficulty: 1, rating: 850, fen: 'k7/8/1K6/8/8/8/8/7Q w - - 0 1', solution: ['h1h8'], hint: 'The queen can reach the eighth rank.', explanation: 'Qh8 is mate because the king on b6 covers the escape squares.' },
  { id: 'stub3', title: 'Knight fork of king and queen', theme: 'fork', difficulty: 2, rating: 1000, fen: '4k3/8/8/3q4/8/8/4N3/4K3 w - - 0 1', solution: ['e2f4', 'e8f7', 'f4d5'], hint: 'A knight check can attack two pieces.', explanation: 'Nf4+ attacks the king and the queen, and the queen falls next move.' },
];
class PuzzleSession {
  constructor(pz) { this.puzzle = pz; this.reset(); }
  reset() { this.position = Position.fromFen(this.puzzle.fen); this.playerColor = this.position.turn; this.index = 0; this.hintStage = 0; }
  tryMove(m) {
    const u = this.position.moveToUci(m); const exp = this.puzzle.solution[this.index];
    const next = this.position.makeMove(m); const last = this.index === this.puzzle.solution.length - 1;
    if (u !== exp && !(last && next.isCheckmate())) return { status: 'wrong' };
    this.position = next; this.index++;
    if (this.index >= this.puzzle.solution.length) return { status: 'complete' };
    const reply = this.position.parseUci(this.puzzle.solution[this.index]); this.position = this.position.makeMove(reply); this.index++;
    if (this.index >= this.puzzle.solution.length) return { status: 'complete', reply };
    return { status: 'correct', reply };
  }
  hint() { const u = this.puzzle.solution[this.index]; this.hintStage++; return this.hintStage === 1 ? { from: sqParse(u.slice(0, 2)) } : { from: sqParse(u.slice(0, 2)), to: sqParse(u.slice(2, 4)) }; }
}
function nextPuzzle(progress = {}, filter = {}) { const done = (progress && progress.puzzles) || {}; const list = PUZZLES.filter((p) => (!filter.theme || p.theme === filter.theme) && !(done[p.id] && done[p.id].solved)); return list[0] || PUZZLES[0]; }
export const puzzles = { PuzzleSession, nextPuzzle };
export const puzzleData = { PUZZLES };
