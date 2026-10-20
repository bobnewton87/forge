import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perimeter, solveSection, _internal } from '../js/engine/anthro.js';

// Brute-force reference: 400k chords per quadrant.
function refPerimeter(a, b, n) {
  let L = 0, px = a, pz = 0; const N = 400000;
  for (let i = 1; i <= N; i++) {
    const t = Math.PI / 2 * i / N;
    const x = i === N ? 0 : a * Math.pow(Math.max(0, Math.cos(t)), 2 / n), z = b * Math.pow(Math.max(0, Math.sin(t)), 2 / n);
    L += Math.hypot(x - px, z - pz); px = x; pz = z;
  }
  return 4 * L;
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

test('perimeter: circle and Ramanujan ellipse', () => {
  assert.ok(rel(perimeter(3, 3, 2), 6 * Math.PI) < 1e-7);
  for (const [a, b] of [[1, 0.75], [6.5, 4.9], [2, 1], [1, 0.3]]) {
    const h = ((a - b) / (a + b)) ** 2;
    const ram = Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
    assert.ok(rel(perimeter(a, b, 2), ram) < 1e-5, `${a},${b}`);
  }
});

test('perimeter: superellipse vs brute force (n 1.3–8, aspect 0.25–4)', () => {
  for (const [a, b, n] of [[1, 0.75, 2.8], [1, 0.75, 3.2], [1, 0.3, 6], [1, 4, 1.5], [2, 1, 8], [1, 1, 1.3], [1, 0.25, 2.4]]) {
    assert.ok(rel(perimeter(a, b, n), refPerimeter(a, b, n)) < 1e-5, `${a},${b},${n}`);
  }
  // n → ∞ tends to the rectangle 4(a+b); larger n → larger perimeter
  assert.ok(perimeter(1, 1, 40) > 7.8 && perimeter(1, 1, 40) < 8);
  assert.ok(perimeter(1, 0.7, 3) > perimeter(1, 0.7, 2.5));
  assert.equal(perimeter(2, 0, 2), 8);   // degenerate segment
});

test('solveSection hits the girth exactly with the requested aspect', () => {
  for (const G of [6.8, 13.5, 22, 39, 46])
    for (const k of [0.6, 0.75, 1, 1.45])
      for (const n of [2, 2.4, 3.2]) {
        const s = solveSection(G, k, n);
        assert.ok(rel(perimeter(s.rx, s.rz, s.n), G) < 1e-6);
        assert.ok(Math.abs(s.rz / s.rx - k) < 1e-12);
      }
});

test('monotone cubic never overshoots the samples', () => {
  const prof = [0, 1, 2, 3, 4, 5].map((y, i) => ({ y, rx: [1, 1, 3, 3.1, 2, 2][i], rz: 1, n: 2, cx: 0, cz: 0 }));
  for (let y = 0; y <= 5; y += 0.01) {
    const p = _internal.interpProfile(prof, y);
    const i = Math.min(4, Math.floor(y));
    const lo = Math.min(prof[i].rx, prof[i + 1].rx), hi = Math.max(prof[i].rx, prof[i + 1].rx);
    assert.ok(p.rx >= lo - 1e-9 && p.rx <= hi + 1e-9, `y=${y} rx=${p.rx}`);
  }
  assert.equal(_internal.interpProfile(prof, 5.5), null);
});
