import fs from 'fs';
import { toCp } from '/workspace/chess/src/puzzle-verify.js';
const rows = [0,1,2,3].flatMap(i => JSON.parse(fs.readFileSync(`/tmp/val/full-${i}.json`)));
let steps = 0, A = 0, B = 0, C = 0, D = 0; const bad = new Set(), badB = new Set(), badA = new Set(); const lv = {};
const detail=[];
for (const r of rows) {
  lv[r.level] = lv[r.level] || { n: 0, bad: 0 }; lv[r.level].n++;
  let flagged = false;
  for (const s of r.steps) {
    steps++;
    const top = s.lines[0], sec = s.lines[1]; const sol = s.lines.find(l => l.move === s.sol);
    // A: parent's criterion: a second move within 150 cp of the solution that is itself >= +200
    const solV = sol ? toCp(sol) : -Infinity;
    const others = s.lines.filter(l => l.move !== s.sol);
    const aFlag = others.some(o => toCp(o) >= 200 && solV - toCp(o) < 150);
    // B: the engine's best move is not the stored solution
    const bFlag = top.move !== s.sol;
    // D: solver is not clearly winning after the solution (< +100)
    const dFlag = !(solV >= 100);
    if (aFlag) { A++; badA.add(r.code); }
    if (bFlag) { B++; badB.add(r.code); }
    if (dFlag) D++;
    if (aFlag || bFlag || dFlag) { flagged = true; detail.push(`${r.code} ${r.level} k${s.i} sol=${s.sol}:${solV} ${s.lines.map(l=>l.move+':'+toCp(l)).join(' ')}`); }
  }
  if (flagged) { bad.add(r.code); lv[r.level].bad++; }
}
console.log('non-mate puzzles', rows.length, 'solver steps', steps);
console.log('A second move within 150cp and >=+200: steps', A, 'puzzles', badA.size);
console.log('B engine best != solution: steps', B, 'puzzles', badB.size);
console.log('D solution < +100: steps', D);
console.log('any flag: puzzles', bad.size, (100*bad.size/rows.length).toFixed(2)+'%', JSON.stringify(lv));
console.log(detail.join('\n'));
