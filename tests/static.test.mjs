// Static checks of shipped files: the service worker precache list and the captured-piece outline.
// Run: node tests/static.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- Service worker ----
const sw = read('sw.js');
const cacheName = (/const CACHE = '([^']+)'/.exec(sw) || [])[1];
check('the cache name has the form ornate-chess-YYYY-MM-DD-xN', /^ornate-chess-\d{4}-\d{2}-\d{2}-[a-z]\d+$/.test(cacheName || ''), cacheName);
const list = (/const PRECACHE = \[([\s\S]*?)\];/.exec(sw) || [, ''])[1];
const entries = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
check('the precache list has no duplicates', new Set(entries).size === entries.length, entries.filter((e, i) => entries.indexOf(e) !== i).join(', '));
for (const e of entries) {
  const f = e === './' ? 'index.html' : e.replace(/^\.\//, '');
  if (!fs.existsSync(path.join(ROOT, f))) check(`precache entry exists: ${e}`, false);
}
check('every precache entry exists', true);
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name).split(path.sep).join('/')]));
const shipped = [...walk('src'), ...walk('assets'), 'index.html', 'manifest.webmanifest'];
const missing = shipped.filter((f) => !entries.includes('./' + f) && !(f === 'index.html' && entries.includes('./')));
check('every shipped file is in the precache list', missing.length === 0, missing.join(', '));
for (const must of ['src/puzzle-gen-worker.js', 'src/puzzle-gen.js', 'src/puzzle-verify.js', 'src/ui/puzzle-gen-client.js', 'src/ui/stockfish-client.js', 'src/ui/dev-stubs.js', 'src/vendor/stockfish/stockfish-19-lite-single.js', 'src/vendor/stockfish/stockfish-19-lite-single.wasm', 'src/data/opening-library.js']) {
  check(`the precache list contains ${must}`, entries.includes('./' + must));
}

// ---- Captured pieces keep a visible outline ----
const css = read('src/styles/board.css');
const rule = /\.cap-b svg\s*\{([^}]*)\}/.exec(css);
check('board.css has a rule for captured black pieces', !!rule);
check('the rule draws an outline with drop-shadow filters', !!rule && (rule[1].match(/drop-shadow\(/g) || []).length >= 2 && /filter\s*:/.test(rule[1]));
const game = read('src/ui/gameview.js');
check('captured pieces are drawn with the cap-b class for black pieces', /cap-\$\{color === 'w' \? 'b' : 'w'\}/.test(game));

// ---- Engine licence ----
check('the engine licence and notice ship with the engine', fs.existsSync(path.join(ROOT, 'src/vendor/stockfish/COPYING.txt')) && /GNU GENERAL PUBLIC LICENSE/.test(read('src/vendor/stockfish/COPYING.txt')) && /github\.com\/nmrugg\/stockfish\.js/.test(read('src/vendor/stockfish/README.txt')));

console.log(`\nStatic checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
