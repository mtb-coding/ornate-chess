// Tests for the opening library data (src/data/opening-library.js).
// Run: node tests/opening-library.test.mjs
import { Position, START_FEN } from '../src/engine.js';
import { LIBRARY, LIBRARY_CATEGORIES } from '../src/data/opening-library.js';
import { OPENINGS, identifyOpening } from '../src/openings.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }

check('the library has between 60 and 130 openings', LIBRARY.length >= 60 && LIBRARY.length <= 130, String(LIBRARY.length));
const ids = new Set();
const catIds = new Set(LIBRARY_CATEGORIES.map((c) => c.id));
const dataset = new Map(OPENINGS.map((o) => [`${o.name}|${o.sans.join(' ')}`, o]));
const SENTENCE = /^[A-Z0-9][^!?]*\.$/;
for (const o of LIBRARY) {
  check(`${o.id}: unique id`, !ids.has(o.id)); ids.add(o.id);
  check(`${o.id}: ECO code is a letter A to E followed by two digits`, /^[A-E]\d\d$/.test(o.eco), o.eco);
  check(`${o.id}: valid category`, catIds.has(o.category), o.category);
  check(`${o.id}: valid side`, o.side === 'w' || o.side === 'b');
  let pos = Position.fromFen(START_FEN);
  let ok = true;
  for (const san of o.moves.split(' ')) {
    const m = pos.parseSan(san);
    if (!m) { ok = false; check(`${o.id}: ${san} is legal`, false, o.moves); break; }
    if (pos.toSan(m) !== san) { ok = false; check(`${o.id}: ${san} is written in canonical SAN`, false, pos.toSan(m)); }
    pos = pos.makeMove(m);
  }
  check(`${o.id}: all moves are legal from the start position`, ok);
  const ref = dataset.get(`${o.name}|${o.moves}`);
  check(`${o.id}: name and moves match the lichess opening dataset`, !!ref, o.name);
  check(`${o.id}: ECO code matches the dataset`, ref && ref.eco === o.eco, ref ? `${ref.eco} vs ${o.eco}` : '');
  const r = identifyOpening(o.moves.split(' '));
  check(`${o.id}: the in-game recogniser names the same opening`, r && r.name === o.name && r.eco === o.eco, r ? `${r.eco} ${r.name}` : 'null');
  // Category agrees with the first moves.
  const first = o.moves.split(' ');
  const expected = first[0] === 'e4' ? (first[1] === 'e5' ? 'open' : 'semi-open') : first[0] === 'd4' ? (first[1] === 'd5' ? 'closed' : (first[1] === 'Nf6' && (o.name.startsWith('Catalan') || o.name.startsWith("Queen's Gambit Declined"))) ? 'closed' : 'indian') : 'flank';
  check(`${o.id}: category matches the first moves`, o.category === expected, `${o.category} vs ${expected}`);
  const sentences = o.description.split(/(?<=\.)\s+(?=[A-Z])/);
  check(`${o.id}: description is objective complete sentences`, sentences.length >= 2 && sentences.every((s) => SENTENCE.test(s) && s.split(/\s+/).length >= 5), o.description);
}
for (const c of LIBRARY_CATEGORIES) check(`category ${c.id} has openings`, LIBRARY.some((o) => o.category === c.id));
const ecoLetters = new Set(LIBRARY.map((o) => o.eco[0]));
check('every ECO volume A to E is represented', ['A', 'B', 'C', 'D', 'E'].every((l) => ecoLetters.has(l)));
console.log(`\nOpening library tests: ${pass} passed, ${fail} failed (${LIBRARY.length} openings)`);
process.exit(fail ? 1 : 0);
