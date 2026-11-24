/**
 * Audit every puzzle: legality, forced-mate correctness, theme honesty,
 * and (optionally) whether the first move is uniquely best by search.
 *
 * Usage: node tools/audit-puzzles.mjs [--search]
 */
import { Position } from '../src/engine.js';
import { PUZZLES } from '../src/data/puzzles.js';
import { verifyPuzzle } from '../src/puzzles.js';
import * as T from './puzzle-tactics.mjs';

const USE_SEARCH = process.argv.includes('--search');

const issues = [];
function flag(p, kind, msg) {
  issues.push({ id: p.id, title: p.title, theme: p.theme, kind, msg });
}

function mateN(theme) {
  if (theme === 'mate-in-1') return 1;
  if (theme === 'mate-in-2') return 2;
  if (theme === 'mate-in-3') return 3;
  if (theme === 'mate-in-4') return 4;
  return 0;
}

for (const p of PUZZLES) {
  const v = verifyPuzzle(p);
  if (!v.ok) flag(p, 'illegal', v.errors.join('; '));

  let pos;
  try { pos = Position.fromFen(p.fen); } catch (e) {
    flag(p, 'fen', e.message);
    continue;
  }

  const first = pos.parseUci(p.solution[0]);
  if (!first) continue;

  const n = mateN(p.theme);
  if (n > 0) {
    const mates = T.matingFirstMoves(pos, n);
    const sol = p.solution[0].toLowerCase();
    if (!mates.map((u) => u.toLowerCase()).includes(sol)) {
      // Maybe a faster mate is required? If this first move mates in fewer, that's OK
      // only if it still mates. Check remaining.
      let faster = false;
      for (let k = 1; k < n; k++) {
        if (T.matingFirstMoves(pos, k).map((u) => u.toLowerCase()).includes(sol)) { faster = true; break; }
      }
      if (!faster) flag(p, 'mate', `first move ${sol} does not force mate in ${n} (found: ${mates.join(',') || 'none'})`);
    }
    // Uniqueness
    if (mates.length > 1) {
      const listed = new Set([
        sol,
        ...((p.alternatives && p.alternatives[0]) || []).map((u) => u.toLowerCase()),
      ]);
      const missing = mates.filter((u) => !listed.has(u.toLowerCase()));
      if (missing.length) flag(p, 'alts', `unlisted mating first moves: ${missing.join(', ')}`);
    }
    // Play main line to mate
    const line = T.playLine(p.fen, p.solution);
    if (line.ok && !line.pos.isCheckmate()) flag(p, 'mate', 'main line does not end in checkmate');
  }

  // Theme checks
  const disc = T.isDiscoveredAttack(pos, first);
  const fork = T.isFork(pos, first);
  const skewer = T.isSkewer(pos, first);
  const pin = T.isPinMove(pos, first);
  const promo = T.isPromotionMove(first);
  const sacLoss = T.immediateMaterialLoss(pos, first);

  const line = T.playLine(p.fen, p.solution);
  const lastMove = (() => {
    if (!line.ok || p.solution.length === 0) return first;
    let p0 = Position.fromFen(p.fen);
    let m = first;
    for (const u of p.solution) { m = p0.parseUci(u); if (!m) break; p0 = p0.makeMove(m); }
    return m;
  })();
  const backRank = line.ok && line.pos.isCheckmate() ? T.isBackRankMate(line.pos, lastMove) : false;
  const smothered = line.ok && line.pos.isCheckmate() ? T.isSmotheredMate(line.pos, lastMove) : false;

  if (p.theme === 'discovered') {
    if (!disc) flag(p, 'theme', 'theme is discovered but the first move does not uncover a sliding attack');
  } else if (T.textMentions(p, 'discovered attack', 'discovered check', 'uncover an attack', 'discovery')) {
    if (!disc) flag(p, 'text', 'text claims a discovered attack, but none is present');
  }

  if (p.theme === 'fork') {
    if (!fork) flag(p, 'theme', 'theme is fork but the moving piece does not attack two enemy units after the first move');
  } else if (T.textMentions(p, 'fork')) {
    if (!fork) flag(p, 'text', 'text claims a fork, but the moving piece does not attack two targets');
  }

  if (p.theme === 'skewer') {
    if (!skewer) flag(p, 'theme', 'theme is skewer but the first move does not skewer two enemy units');
  } else if (T.textMentions(p, 'skewer')) {
    if (!skewer) flag(p, 'text', 'text claims a skewer, but none is present');
  }

  if (p.theme === 'pin') {
    if (!pin) flag(p, 'theme', 'theme is pin but the first move neither creates a pin nor captures a pinned piece');
  } else if (T.textMentions(p, ' pin', 'pinned', 'pins ')) {
    if (!pin && !T.pinsIn(pos, pos.turn).length) flag(p, 'text', 'text claims a pin, but none is present');
  }

  if (p.theme === 'promotion') {
    if (!promo) flag(p, 'theme', 'theme is promotion but the first move does not promote');
  }
  if (T.textMentions(p, 'underpromotion', 'knight promotion', 'promoting to a knight')) {
    if (!first.promotion || first.promotion === 'q') {
      flag(p, 'text', 'text claims underpromotion / knight promotion, but the solution promotes to ' + (first.promotion || 'nothing'));
    }
  }

  if (p.theme === 'back-rank') {
    if (!backRank) flag(p, 'theme', 'theme is back-rank but the line does not deliver back-rank mate');
  }

  if (T.textMentions(p, 'smothered')) {
    if (!smothered) flag(p, 'text', 'text claims smothered mate, but the final mate is not a smothered knight mate');
  }

  if (p.theme === 'sacrifice') {
    if (sacLoss <= 0 && n === 0) {
      // Immediate mate can be mistagged; if it's already mate, it's not a sacrifice.
    }
    if (line.ok && line.pos.isCheckmate() && p.solution.length === 1) {
      flag(p, 'theme', 'theme is sacrifice but the first move is already checkmate (nothing is sacrificed)');
    } else if (sacLoss <= 0) {
      flag(p, 'theme', `theme is sacrifice but the first move does not give up material (loss=${sacLoss})`);
    }
  }

  if (p.theme === 'deflection') {
    // A one-move mate by capturing the "defender" is not a deflection.
    if (p.solution.length === 1 && line.ok && line.pos.isCheckmate()) {
      flag(p, 'theme', 'theme is deflection but the first move is already checkmate; no piece is deflected');
    }
  }

  // Generic misleading phrases we noticed
  if (/search validates/i.test(p.explanation) || /when the geometry fits/i.test(p.explanation)) {
    flag(p, 'text', 'explanation hedges instead of describing the actual move');
  }
}

// Optional search-based uniqueness / best-move check for non-mate tactics
if (USE_SEARCH) {
  const { analyze, chooseMove } = await import('../src/ai.js');
  for (const p of PUZZLES) {
    const n = mateN(p.theme);
    if (n > 0) continue; // already checked by brute force
    let pos;
    try { pos = Position.fromFen(p.fen); } catch { continue; }
    const legal = pos.legalMoves();
    if (legal.length === 0) continue;
    // Depth 5, 1.2s should be enough for sparse boards
    const rows = await analyze(pos, { depth: 6, timeMs: 1500, multiPv: Math.min(5, legal.length) });
    if (!rows.length) continue;
    const best = rows[0];
    const bestUci = pos.moveToUci(best.move).toLowerCase();
    const sol = p.solution[0].toLowerCase();
    const listed = new Set([sol, ...((p.alternatives && p.alternatives[0]) || []).map((u) => u.toLowerCase())]);
    if (!listed.has(bestUci)) {
      flag(p, 'best', `search prefers ${bestUci} (score ${best.score}) over solution ${sol}`);
    }
    if (rows.length >= 2) {
      const gap = best.score - rows[1].score;
      const second = pos.moveToUci(rows[1].move).toLowerCase();
      if (gap < 40 && !listed.has(second)) {
        flag(p, 'unique', `first move may not be unique: ${bestUci} ${best.score} vs ${second} ${rows[1].score}`);
      }
    }
  }
}

const byKind = {};
for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
console.log(JSON.stringify({ count: PUZZLES.length, issueCount: issues.length, byKind, issues }, null, 2));
