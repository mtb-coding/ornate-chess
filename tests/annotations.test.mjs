// Board annotation tests: state, colours by modifier and arrow geometry.
// Run: node tests/annotations.test.mjs
import assert from 'node:assert/strict';
import { Annotations, ANNOTATION_COLORS, ANNOTATION_HELP, colorForModifiers, squareCenter, isKnightJump, arrowPoints, arrowOutline, arrowPathD, engineArrowGeometry } from '../src/ui/annotations.js';

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`PASS  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n  ${e.message}`); } }
const S = (n) => 'abcdefgh'.indexOf(n[0]) + 8 * (Number(n[1]) - 1);

test('four colours are defined with translucent square fills', () => {
  assert.deepEqual(Object.keys(ANNOTATION_COLORS), ['gold', 'green', 'red', 'blue']);
  for (const c of Object.values(ANNOTATION_COLORS)) assert.match(c.square, /^rgba\(.+, \.\d+\)$/);
});
test('modifier keys choose the colour', () => {
  assert.equal(colorForModifiers({}), 'gold');
  assert.equal(colorForModifiers({ shiftKey: true }), 'green');
  assert.equal(colorForModifiers({ ctrlKey: true }), 'red');
  assert.equal(colorForModifiers({ metaKey: true }), 'red');
  assert.equal(colorForModifiers({ altKey: true }), 'blue');
  assert.equal(colorForModifiers({ ctrlKey: true, shiftKey: true }), 'blue');
  assert.equal(colorForModifiers({ altKey: true, shiftKey: true }), 'blue');
});
test('a highlight toggles on and off, and another colour replaces it', () => {
  const a = new Annotations();
  assert.equal(a.toggleHighlight(S('e4')), 'gold');
  assert.equal(a.highlights.get(S('e4')), 'gold');
  assert.equal(a.toggleHighlight(S('e4'), 'red'), 'red');
  assert.equal(a.highlights.size, 1);
  assert.equal(a.toggleHighlight(S('e4'), 'red'), null);
  assert.ok(a.isEmpty);
});
test('an arrow is drawn, recoloured and removed by repeating it', () => {
  const a = new Annotations();
  a.toggleArrow(S('e2'), S('e4'));
  a.toggleArrow(S('g1'), S('f3'), 'green');
  assert.equal(a.arrows.length, 2);
  a.toggleArrow(S('e2'), S('e4'), 'blue');
  assert.deepEqual(a.arrows[0], { from: S('e2'), to: S('e4'), color: 'blue' });
  a.toggleArrow(S('e2'), S('e4'), 'blue');
  assert.equal(a.arrows.length, 1);
  a.toggleArrow(S('e4'), S('e2'));
  assert.equal(a.arrows.length, 2, 'the reverse direction is a different arrow');
  a.toggleArrow(S('d4'), S('d4'));
  assert.equal(a.highlights.get(S('d4')), 'gold', 'an arrow to the same square is a highlight');
});
test('clear removes everything and reports whether anything was there', () => {
  const a = new Annotations();
  assert.equal(a.clear(), false);
  a.toggleHighlight(1); a.toggleArrow(1, 18);
  assert.equal(a.clear(), true);
  assert.ok(a.isEmpty);
  assert.deepEqual(a.snapshot(), { highlights: [], arrows: [] });
});
test('square centres follow the board orientation', () => {
  assert.deepEqual(squareCenter(S('a1'), 'w'), [50, 750]);
  assert.deepEqual(squareCenter(S('h8'), 'w'), [750, 50]);
  assert.deepEqual(squareCenter(S('a1'), 'b'), [750, 50]);
  assert.deepEqual(squareCenter(S('e4'), 'b'), [350, 350]);
});
test('knight jumps are recognised', () => {
  assert.ok(isKnightJump(S('g1'), S('f3')));
  assert.ok(isKnightJump(S('b1'), S('d2')));
  assert.ok(!isKnightJump(S('e2'), S('e4')));
  assert.ok(!isKnightJump(S('a1'), S('c3')));
});
test('knight arrows are L-shaped with the long leg first', () => {
  // g1-f3 from White: up two ranks, then left one file.
  assert.deepEqual(arrowPoints(S('g1'), S('f3'), 'w'), [[650, 750], [650, 550], [550, 550]]);
  // b1-d2: right two files, then up one rank.
  assert.deepEqual(arrowPoints(S('b1'), S('d2'), 'w'), [[150, 750], [350, 750], [350, 650]]);
  // The same move seen from Black is mirrored.
  assert.deepEqual(arrowPoints(S('g1'), S('f3'), 'b'), [[150, 50], [150, 250], [250, 250]]);
  assert.equal(arrowPoints(S('e2'), S('e4')).length, 2);
});
test('the arrow outline is one closed shape with a head wider than the shaft', () => {
  const o = arrowOutline(S('e2'), S('e4'), 'w');
  assert.equal(o.knight, false);
  assert.equal(o.points.length, 7);
  const xs = o.points.map((p) => p[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 40, 'head is wide');
  assert.deepEqual(o.tip, [450, 458]);
  const k = arrowOutline(S('g1'), S('f3'), 'w');
  assert.equal(k.knight, true);
  assert.equal(k.points.length, 9);
  assert.match(arrowPathD(S('g1'), S('f3')), /^M[\d. L]+ Z$/);
  // Flipping the board moves the tip to the mirrored square.
  assert.deepEqual(arrowOutline(S('e2'), S('e4'), 'b').tip, [350, 342]);
});
test('engine knight arrows are L-shaped with the long leg first and a tip on the destination', () => {
  const g = engineArrowGeometry(S('f3'), S('g5'), 'w', { piece: 'n' });
  assert.equal(g.knight, true);
  assert.equal(g.points.length, 3);
  // f3 -> f5 (two squares up) -> g5 (one square right), tip short of g5.
  assert.deepEqual(g.points[0], [550, 550]);
  assert.deepEqual(g.points[1], [550, 350]);
  assert.equal(g.points[2][1], 350);
  assert.ok(g.points[2][0] < 650, 'tip is inset from the destination centre');
  assert.match(g.d, /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);
  const pawn = engineArrowGeometry(S('e2'), S('e4'), 'w', { piece: 'p' });
  assert.equal(pawn.knight, false);
  assert.equal(pawn.points.length, 2);
  assert.match(pawn.d, /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);
});
test('engine knight arrows stay L-shaped and are mirrored on a flipped board', () => {
  const w = engineArrowGeometry(S('f3'), S('g5'), 'w', { piece: 'n' });
  const b = engineArrowGeometry(S('f3'), S('g5'), 'b', { piece: 'n' });
  assert.equal(b.knight, true);
  assert.equal(b.points.length, 3);
  // The first leg is still the long (two-square) one, then a 90-degree turn.
  const longW = Math.hypot(w.points[1][0] - w.points[0][0], w.points[1][1] - w.points[0][1]);
  const shortW = Math.hypot(w.points[2][0] - w.points[1][0], w.points[2][1] - w.points[1][1]);
  const longB = Math.hypot(b.points[1][0] - b.points[0][0], b.points[1][1] - b.points[0][1]);
  const shortB = Math.hypot(b.points[2][0] - b.points[1][0], b.points[2][1] - b.points[1][1]);
  assert.ok(longW > shortW && longB > shortB);
  assert.notDeepEqual(w.points, b.points);
  // A known non-knight is straight even if the squares are a 1-by-2 jump.
  const forced = engineArrowGeometry(S('f3'), S('g5'), 'w', { piece: 'q' });
  assert.equal(forced.knight, false);
  assert.equal(forced.points.length, 2);
  // With no piece, 1-by-2 geometry still produces an L.
  const inferred = engineArrowGeometry(S('g1'), S('f3'), 'w');
  assert.equal(inferred.knight, true);
  assert.equal(inferred.points.length, 3);
});
test('the help text is one complete sentence that names every colour', () => {
  assert.match(ANNOTATION_HELP, /^[A-Z][^.]+\.$/);
  for (const w of ['right-click', 'Shift', 'Ctrl', 'Alt', 'gold', 'green', 'red', 'blue', 'left-click']) assert.ok(ANNOTATION_HELP.includes(w), w);
});

console.log(`\nAnnotation tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
