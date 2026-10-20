import { describe, expect, it } from 'vitest';
import {
  advanceClock,
  autoRows,
  bezier,
  buildIntegral,
  capGrid,
  cellMix,
  easeFn,
  flickerIndex,
  forwardEase,
  glideFlicker,
  levels,
  luma,
  MAX_CELLS,
  REVEAL_MIN_MS,
  ORDERS,
  rampIndex,
  safeFlicker,
  sampleGrid,
  shade,
  stampPath,
  stampReveal,
  stepReveal,
  stretch,
  thresholds,
  transitionFrame,
  type Transition,
} from '../src/core';
/** w × h RGBA, each pixel from fn(x, y). */
function image(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number?]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      d.set([r, g, b, a], (y * w + x) * 4);
    }
  return d;
}

describe('sampleGrid', () => {
  it('averages each cell box', () => {
    // left half black, right half white
    const int = buildIntegral(
      image(4, 2, (x) => (x < 2 ? [0, 0, 0] : [255, 255, 255])),
      4,
      2,
    );
    expect([...sampleGrid(int, 2, 1)]).toEqual([0, 0, 0, 255, 255, 255]);
    expect([...sampleGrid(int, 1, 1)]).toEqual([127.5, 127.5, 127.5]);
  });

  it('counts a transparent pixel as black', () => {
    const int = buildIntegral(
      image(2, 1, (x) => [255, 0, 0, x === 0 ? 0 : 255]),
      2,
      1,
    );
    expect(sampleGrid(int, 1, 1)[0]).toBe(127.5);
  });

  it('gives every cell at least one pixel when the grid is finer than the image', () => {
    const int = buildIntegral(
      image(2, 2, () => [10, 20, 30]),
      2,
      2,
    );
    expect([...sampleGrid(int, 5, 5)].every((v, i) => v === [10, 20, 30][i % 3])).toBe(true);
  });
});

describe('colour and ramp', () => {
  it('greys and tints by luminance', () => {
    const near = (a: readonly number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!));
    near(shade(255, 255, 255, 'grey', 1), [255, 255, 255]);
    near(shade(0, 0, 0, [255, 0, 0], 1), [255, 0, 0]);
    // the hue stays, the brightness follows the stretched luminance, never below the floor
    near(shade(10, 20, 40, 'original', 1), [63.75, 127.5, 255]);
    expect(Math.max(...shade(1, 2, 4, 'original', 0))).toBeCloseTo(255 * 0.45);
  });

  it('stretches the brightness over the darkest and brightest cells', () => {
    const r = levels([25, 25, 25, 100, 100, 100]);
    expect(stretch(luma(25, 25, 25), r)).toBe(0);
    expect(stretch(luma(100, 100, 100), r)).toBe(1);
    expect(levels([9, 9, 9, 9, 9, 9])).toEqual([0, 1]);
  });

  it('maps brightness onto the ramp, and back to front when inverted', () => {
    expect(rampIndex(0, 10)).toBe(0);
    expect(rampIndex(1, 10)).toBe(9);
    expect(rampIndex(1, 10, true)).toBe(0);
  });

  it('keeps glyph proportions in the auto rows and caps big grids', () => {
    expect(autoRows(100, 1)).toBe(60);
    const [c, r] = capGrid(1000, 1000);
    expect(c * r).toBeLessThanOrEqual(MAX_CELLS);
    expect(c).toBe(r);
  });
});

describe('flicker', () => {
  const f = { randomness: 1, speed: 3, speedRandomness: 0 };

  it('stays on the brightness glyph without randomness', () => {
    expect(flickerIndex(5, 4, 15, { a: 12.3, b: 4 }, 0)).toBe(4);
  });

  it('strays at most randomness × ramp from its glyph and stays on the ramp', () => {
    for (let a = 0; a < 60; a += 0.3) {
      expect(Math.abs(flickerIndex(3, 7, 15, { a, b: a / 2 }, 0.1) - 7)).toBeLessThanOrEqual(
        Math.round(0.1 * 14),
      );
      expect(flickerIndex(3, 14, 15, { a, b: 0 }, 1)).toBeLessThanOrEqual(14);
    }
  });

  it('changes about `speed` times a second', () => {
    const clock = { a: 0, b: 0 };
    let changes = 0;
    let last = flickerIndex(9, 7, 15, clock, 1);
    for (let i = 0; i < 1000; i++) {
      advanceClock(clock, 0.01, f);
      const g = flickerIndex(9, 7, 15, clock, 1);
      if (g !== last) changes++;
      last = g;
    }
    expect(changes).toBeLessThanOrEqual(30);
    expect(changes).toBeGreaterThan(15); // some ticks land on the same glyph
  });

  it('keeps every glyph where it is when the speed changes', () => {
    const clock = { a: 41.7, b: 3.2 };
    const before = Array.from({ length: 500 }, (_, i) => flickerIndex(i, 7, 15, clock, 0.5));
    advanceClock(clock, 0, { ...f, speed: 12 }); // a new speed, no time yet
    expect(Array.from({ length: 500 }, (_, i) => flickerIndex(i, 7, 15, clock, 0.5))).toEqual(before);
  });

  it('glides towards a target and lands on it', () => {
    let cur = { randomness: 0.1, speed: 1, speedRandomness: 0 };
    const to = { randomness: 0.1, speed: 5, speedRandomness: 0 };
    cur = glideFlicker(cur, to, 100, 400);
    expect(cur.speed).toBeGreaterThan(1);
    expect(cur.speed).toBeLessThan(5);
    for (let i = 0; i < 100; i++) cur = glideFlicker(cur, to, 16, 400);
    expect(cur).toEqual(to);
    expect(glideFlicker({ ...cur, speed: 1 }, to, 16, 0)).toEqual(to);
  });

  it('caps the rate for WCAG 2.3.1 by how far glyphs stray', () => {
    expect(safeFlicker({ randomness: 0.1, speed: 12, speedRandomness: 0 }, 15).speed).toBe(6);
    expect(safeFlicker({ randomness: 1, speed: 12, speedRandomness: 0 }, 15).speed).toBe(3);
    // the fastest cell is what counts
    expect(safeFlicker({ randomness: 1, speed: 3, speedRandomness: 0.5 }, 15).speed).toBe(2);
    const ok = { randomness: 0.1, speed: 3, speedRandomness: 0.5 };
    expect(safeFlicker(ok, 15)).toBe(ok);
  });
});

describe('thresholds', () => {
  it('starts the center order in the middle and the shower at the top', () => {
    const c = thresholds(21, 21, 'center', 1);
    expect(c[10 * 21 + 10]!).toBeLessThan(c[0]!);
    const s = thresholds(10, 10, 'shower', 1);
    for (let x = 0; x < 10; x++) expect(s[x]!).toBeLessThan(s[90 + x]!);
  });

  it('sweeps the scan down, the wipe across and the raster row by row', () => {
    const scan = thresholds(4, 4, 'scan', 1);
    expect(scan[0]).toBe(scan[3]);
    expect(scan[0]!).toBeLessThan(scan[4]!);
    const wipe = thresholds(4, 4, 'wipe', 1);
    expect(wipe[0]).toBe(wipe[12]);
    expect(wipe[0]!).toBeLessThan(wipe[1]!);
    const raster = thresholds(4, 4, 'raster', 1);
    expect([...raster]).toEqual([...raster].sort((a, b) => a - b));
  });

  it('puts the even rows first in interlace', () => {
    const t = thresholds(3, 6, 'interlace', 1);
    expect(t[4 * 3]!).toBeLessThan(t[1 * 3]!);
  });

  it.each(ORDERS)('%s stays within [0, 1) and spreads over the run', (o) => {
    const t = thresholds(40, 30, o, 0.75);
    expect(Math.min(...t)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...t)).toBeLessThan(1);
    expect(Math.max(...t) - Math.min(...t)).toBeGreaterThan(0.5);
  });
});

describe('easing', () => {
  it('matches CSS at the known points', () => {
    const lin = bezier([0, 0, 1, 1]);
    for (const x of [0, 0.25, 0.5, 0.9, 1]) expect(lin(x)).toBeCloseTo(x, 4);
    const io = easeFn('in-out');
    expect(io(0.5)).toBeCloseTo(0.5, 4);
    expect(io(0.25) + io(0.75)).toBeCloseTo(1, 4); // symmetric
    expect(easeFn('ease')(0.5)).toBeCloseTo(0.8024, 3); // the CSS value
  });

  it('steps', () => {
    const s = easeFn({ steps: 4 });
    expect([0, 0.24, 0.25, 0.6, 0.99, 1].map(s)).toEqual([0, 0, 0.25, 0.5, 0.75, 1]);
  });

  it('never goes back in a transition, even on a curve that dips', () => {
    const dip = forwardEase([0.5, 1.5, 0.5, -0.5]);
    let prev = -Infinity;
    for (let x = 0; x <= 1.0001; x += 0.01) {
      expect(dip(x)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = dip(x);
    }
    expect(dip(1)).toBeCloseTo(1, 3);
    expect(forwardEase('linear')(0.3)).toBeCloseTo(0.3, 3);
  });
});

describe('transitions', () => {
  const tr: Transition = {
    durationMs: 1000,
    order: 'center',
    ease: 'linear',
    edge: 0.1,
    reverse: false,
    backdrop: 'image',
  };
  const t = thresholds(80, 48, 'center', 1);
  const mixes = (dir: 'in' | 'out', ms: number, o = tr) =>
    [...t].map((v) => cellMix(v, transitionFrame(o, dir, ms)));

  it('turns the image into glyphs from nothing to all', () => {
    expect(mixes('in', 0).every((k) => k === 0)).toBe(true);
    const mid = mixes('in', 500);
    expect(mid.some((k) => k === 1)).toBe(true);
    expect(mid.some((k) => k === 0)).toBe(true);
    expect(mid.some((k) => k > 0 && k < 1)).toBe(true); // the front
    expect(mixes('in', 1000).every((k) => k === 1)).toBe(true);
  });

  it('turns them back, the first in being the first out', () => {
    expect(mixes('out', 0).every((k) => k === 1)).toBe(true);
    const centre = 24 * 80 + 40;
    expect(mixes('out', 300)[centre]).toBe(0);
    expect(mixes('out', 300)[0]).toBe(1);
    expect(mixes('out', 1000).every((k) => k === 0)).toBe(true);
  });

  it('runs the order backwards when reversed', () => {
    const mid = mixes('in', 300, { ...tr, reverse: true });
    expect(mid[0]).toBe(1); // a corner first
    expect(mid[24 * 80 + 40]).toBe(0);
  });
});

describe('pointer reveal', () => {
  const cols = 20;
  const rows = 10;
  const p = { radius: 30, softness: 0.5 };

  it('stamps a soft circle, full at the centre and nothing past the radius', () => {
    const f = new Float32Array(cols * rows);
    stampReveal(f, cols, rows, 10, 10, 105, 55, p); // the centre of cell (10, 5)
    expect(f[5 * cols + 10]).toBe(1);
    expect(f[5 * cols + 12]!).toBeGreaterThan(0);
    expect(f[5 * cols + 12]!).toBeLessThan(1);
    expect(f[5 * cols + 14]).toBe(0);
    expect(f[0]).toBe(0);
  });

  it('leaves no gaps along a fast path', () => {
    const f = new Float32Array(cols * rows);
    stampPath(f, cols, rows, 10, 10, { x: 5, y: 55 }, { x: 195, y: 55 }, p);
    for (let x = 0; x < cols; x++) expect(f[5 * cols + x]!).toBeGreaterThan(0.5);
  });

  it('never uncovers or covers a cell faster than REVEAL_MIN_MS (WCAG 2.3.1)', () => {
    const f = new Float32Array(1);
    const on = new Float32Array([1]);
    const off = new Float32Array([0]);
    stepReveal(f, on, REVEAL_MIN_MS / 2, 0);
    expect(f[0]).toBeCloseTo(0.5);
    expect(stepReveal(f, on, REVEAL_MIN_MS, 0)).toEqual({ max: 1, moving: false });
    stepReveal(f, off, REVEAL_MIN_MS / 2, 0); // trail 0 still takes the floor
    expect(f[0]).toBeCloseTo(0.5);
    stepReveal(f, off, REVEAL_MIN_MS, 0);
    expect(f[0]!).toBeLessThan(0.05); // the exponential tail, on the slow side of the floor
    stepReveal(f, off, REVEAL_MIN_MS, 0);
    expect(f[0]).toBe(0);
  });

  it('covers over slower with a longer trail', () => {
    const a = new Float32Array([1]);
    const b = new Float32Array([1]);
    const off = new Float32Array([0]);
    stepReveal(a, off, 100, 300);
    stepReveal(b, off, 100, 2000);
    expect(b[0]!).toBeGreaterThan(a[0]!);
  });
});
