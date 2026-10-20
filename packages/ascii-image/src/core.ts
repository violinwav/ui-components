// The pure half of <AsciiImage>: box-averaged sampling, the character ramp, the flicker clock, the transition orders,
// the easings and the transition timeline.
// No DOM here, so all of it runs (and is tested) in node.

/** Darkest to densest. Index 0 is the empty cell. */
export const DEFAULT_RAMP = ' .,:;i1tfLCG08@';
/** A monospace glyph is about 0.6 of its line height wide; rows follow from it when only the columns are given. */
export const CELL_ASPECT = 0.6;
/** Grids above this are scaled down, keeping their proportions. */
export const MAX_CELLS = 40_000;

export type Rgb = readonly [number, number, number];
/** 'original' keeps each cell's colour, 'grey' its brightness, an Rgb tints the brightness with one colour. */
export type ColorMode = 'original' | 'grey' | Rgb;

export interface Integral {
  w: number;
  h: number;
  /** Summed-area tables, (w + 1) × (h + 1), one per channel. */
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
}

/** Summed-area tables of an RGBA buffer, so any box average afterwards costs four reads per channel. */
export function buildIntegral(data: ArrayLike<number>, w: number, h: number): Integral {
  const W = w + 1;
  const r = new Float64Array(W * (h + 1));
  const g = new Float64Array(W * (h + 1));
  const b = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      // a transparent pixel counts as black: the ramp draws nothing there
      const a = data[p + 3]! / 255;
      sr += data[p]! * a;
      sg += data[p + 1]! * a;
      sb += data[p + 2]! * a;
      const o = (y + 1) * W + x + 1;
      r[o] = r[o - W]! + sr;
      g[o] = g[o - W]! + sg;
      b[o] = b[o - W]! + sb;
    }
  }
  return { w, h, r, g, b };
}

/** The mean colour of each cell of a cols × rows grid laid over the whole image: rgb triples, 0–255. */
export function sampleGrid(
  int: Integral,
  cols: number,
  rows: number,
  out?: Float32Array<ArrayBuffer>,
): Float32Array<ArrayBuffer> {
  const res = out && out.length === cols * rows * 3 ? out : new Float32Array(cols * rows * 3);
  const W = int.w + 1;
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * int.h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * int.h) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * int.w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * int.w) / cols));
      const area = (x1 - x0) * (y1 - y0);
      const a = y0 * W + x0;
      const bR = y0 * W + x1;
      const c = y1 * W + x0;
      const d = y1 * W + x1;
      const o = (cy * cols + cx) * 3;
      res[o] = (int.r[d]! - int.r[bR]! - int.r[c]! + int.r[a]!) / area;
      res[o + 1] = (int.g[d]! - int.g[bR]! - int.g[c]! + int.g[a]!) / area;
      res[o + 2] = (int.b[d]! - int.b[bR]! - int.b[c]! + int.b[a]!) / area;
    }
  }
  return res;
}

/** Relative luminance (Rec. 709 weights), 0–1. */
export const luma = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Darkest and brightest cell of a sample, for stretching the brightness over the whole ramp. */
export function levels(sample: ArrayLike<number>): [lo: number, hi: number] {
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < sample.length; i += 3) {
    const l = luma(sample[i]!, sample[i + 1]!, sample[i + 2]!);
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  return hi - lo < 1e-3 ? [0, 1] : [lo, hi];
}

export const stretch = (l: number, [lo, hi]: readonly [number, number]): number =>
  Math.min(1, Math.max(0, (l - lo) / (hi - lo)));

/** The darkest a drawn glyph gets: the glyph's coverage already shows how dark a cell is, so its colour need not too. */
const FLOOR = 0.45;

/**
 * The colour a cell is drawn in, for its (stretched) brightness `ls`. The glyph carries the brightness, so the colour
 * carries the hue, lifted: a dark cell is a sparse glyph in a readable colour, not a sparse glyph in near-black.
 */
export function shade(r: number, g: number, b: number, mode: ColorMode, ls: number): Rgb {
  const v = 255 * (FLOOR + (1 - FLOOR) * ls);
  if (mode === 'grey') return [v, v, v];
  const [cr, cg, cb] = mode === 'original' ? [r, g, b] : mode;
  const k = v / Math.max(1, cr, cg, cb);
  return [cr * k, cg * k, cb * k];
}

/** Brightness to a ramp position. `invert` puts the dense glyphs on the dark parts (for a light ground). */
export function rampIndex(l: number, len: number, invert = false): number {
  const v = invert ? 1 - l : l;
  return Math.min(len - 1, Math.max(0, Math.round(v * (len - 1))));
}

/** Rows for `cols` columns so each cell keeps the glyph's proportions over an image of aspect h / w. */
export const autoRows = (cols: number, aspect: number, cellAspect = CELL_ASPECT): number =>
  Math.max(1, Math.round(cols * aspect * cellAspect));

/** Scales a grid down until it fits MAX_CELLS, keeping its proportions. */
export function capGrid(cols: number, rows: number, max = MAX_CELLS): [number, number] {
  const n = cols * rows;
  if (n <= max) return [cols, rows];
  const k = Math.sqrt(max / n);
  return [Math.max(1, Math.floor(cols * k)), Math.max(1, Math.floor(rows * k))];
}

/** A stateless hash of two integers to [0, 1): a cell's flicker needs no per-cell memory, so a grid can change size every frame. */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface Flicker {
  /** How far a glyph may stray from its brightness on the ramp, as a share of the ramp (0 keeps it still). */
  randomness: number;
  /** Glyph changes per second per cell. */
  speed: number;
  /** 0–1: how much each cell's rate differs from `speed`. */
  speedRandomness: number;
}

/**
 * The flicker's running time, integrated rather than read off the clock: `a` advances by speed, `b` by speed ×
 * speedRandomness. A cell's glyph depends on where these have got to, so a change of speed changes only how fast the
 * glyphs move on from here, never which glyphs show now (no jump, no fresh set of characters).
 */
export interface FlickerClock {
  a: number;
  b: number;
}

export function advanceClock(c: FlickerClock, dtS: number, f: Flicker | null): void {
  if (!f || f.speed <= 0) return;
  c.a += dtS * f.speed;
  c.b += dtS * f.speed * f.speedRandomness;
}

/** Eases `cur` towards `to` over about `glideMs` (exponential: it can be retargeted at any moment). */
export function glideFlicker(cur: Flicker, to: Flicker, dtMs: number, glideMs: number): Flicker {
  const k = glideMs <= 0 ? 1 : 1 - Math.exp((-3 * dtMs) / glideMs);
  const near = (a: number, b: number) => (Math.abs(b - a) < 1e-3 ? b : a + (b - a) * k);
  return {
    randomness: near(cur.randomness, to.randomness),
    speed: near(cur.speed, to.speed),
    speedRandomness: near(cur.speedRandomness, to.speedRandomness),
  };
}

/** Highest flicker rate within ±1 density step (each change under 10 % luminance), and above it (WCAG 2.3.1). */
export const SAFE_HZ_NEAR = 6;
export const SAFE_HZ_FAR = 3;

/** `f` with its rate capped by how far its glyphs stray: wide swings at most three times a second. */
export function safeFlicker(f: Flicker, rampLen: number): Flicker {
  const steps = f.randomness * (rampLen - 1);
  const max = steps <= 1.5 ? SAFE_HZ_NEAR : SAFE_HZ_FAR; // ≤ 1.5 rounds to ±1 step
  const rate = f.speed * (1 + f.speedRandomness); // the fastest cell's rate
  return rate <= max ? f : { ...f, speed: max / (1 + f.speedRandomness) };
}

export const sameFlicker = (a: Flicker, b: Flicker): boolean =>
  a.randomness === b.randomness && a.speed === b.speed && a.speedRandomness === b.speedRandomness;

/** The glyph a cell shows: its brightness glyph, nudged along the ramp by its own share of the flicker clock. */
export function flickerIndex(
  cell: number,
  base: number,
  len: number,
  clock: FlickerClock,
  randomness: number,
): number {
  if (randomness <= 0) return base;
  const u = hash2(cell, -1) * 2 - 1; // this cell's rate is speed × (1 + speedRandomness × u)
  const tick = Math.floor(clock.a + clock.b * u + hash2(cell, -2));
  const off = Math.round((hash2(cell, tick) * 2 - 1) * randomness * (len - 1));
  return Math.min(len - 1, Math.max(0, base + off));
}

// --- transitions ---------------------------------------------------------------------------------------------------

export const ORDERS = [
  'center',
  'shower',
  'random',
  'scan',
  'raster',
  'wipe',
  'diagonal',
  'interlace',
  'bayer',
  'blocks',
  'glitch',
  'spiral',
] as const;
/** The order the cells turn in. */
export type Order = (typeof ORDERS)[number];

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20,
  62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];
const BELOW_ONE = 0.9999;

/**
 * When each cell turns, 0–1. `aspect` (h / w of the image) keeps the round orders round on screen. The front reaches a
 * cell when the transition's progress passes its value.
 */
export function thresholds(cols: number, rows: number, order: Order, aspect: number, seed = 1): Float32Array {
  const t = new Float32Array(cols * rows);
  const at = (fn: (x: number, y: number, i: number) => number) => {
    for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) t[i] = fn(x, y, i);
  };
  const fx = (x: number) => (cols > 1 ? x / (cols - 1) : 0);
  const fy = (y: number) => (rows > 1 ? y / (rows - 1) : 0);
  switch (order) {
    case 'random':
      at((_x, _y, i) => hash2(seed, i));
      break;
    case 'shower': {
      const ragged = 0.35; // share of the run in which the columns' fronts differ
      at((x, y) => hash2(seed, x) * ragged + fy(y) * (1 - ragged));
      break;
    }
    case 'scan':
      at((_x, y) => fy(y));
      break;
    case 'raster': // a beam: row by row, left to right
      at((x, y) => (y + fx(x)) / rows);
      break;
    case 'wipe':
      at((x) => fx(x));
      break;
    case 'diagonal':
      at((x, y) => (fx(x) + fy(y)) / 2);
      break;
    case 'interlace': // the even rows first, then the odd ones
      at((_x, y) => (y % 2) * 0.5 + fy(y) * 0.5);
      break;
    case 'bayer': // ordered dither: an 8 × 8 pattern fills in evenly
      at((x, y) => (BAYER8[(y % 8) * 8 + (x % 8)]! + hash2(seed, x + y * 7919) * 0.5) / 64);
      break;
    case 'blocks': {
      // macroblocks in a random order, a little noise inside each
      const bw = Math.max(2, Math.round(cols / 14));
      const bh = Math.max(1, Math.round((bw * rows) / (cols * aspect))); // square on screen
      at(
        (x, y, i) =>
          hash2(seed, Math.floor(x / bw) * 7919 + Math.floor(y / bh)) * 0.88 + hash2(seed + 1, i) * 0.12,
      );
      break;
    }
    case 'glitch': {
      // horizontal bands of random height, each tearing across left to right at its own moment
      const band = new Float32Array(rows);
      for (let y = 0, b = 0; y < rows; b++) {
        const h = 1 + Math.floor(hash2(seed, b * 31) * Math.max(2, rows / 8));
        const start = hash2(seed + 2, b) * 0.75;
        for (let k = 0; k < h && y < rows; k++, y++) band[y] = start;
      }
      at((x, y, i) => band[y]! + fx(x) * 0.2 + hash2(seed, i) * 0.05);
      break;
    }
    case 'spiral': {
      const max = Math.hypot(0.5, 0.5 * aspect);
      at((x, y) => {
        const dx = (x + 0.5) / cols - 0.5;
        const dy = ((y + 0.5) / rows - 0.5) * aspect;
        const a = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
        return (Math.hypot(dx, dy) / max) * 0.7 + a * 0.3;
      });
      break;
    }
    default: {
      // center
      const noise = 0.08; // breaks the rings into a grain
      const max = Math.hypot(0.5, 0.5 * aspect);
      at((x, y, i) => {
        const dx = (x + 0.5) / cols - 0.5;
        const dy = ((y + 0.5) / rows - 0.5) * aspect;
        return (Math.hypot(dx, dy) / max) * (1 - noise) + hash2(seed, i) * noise;
      });
    }
  }
  for (let i = 0; i < t.length; i++) t[i] = Math.min(BELOW_ONE, Math.max(0, t[i]!));
  return t;
}

// --- easing --------------------------------------------------------------------------------------------------------

/** CSS's named curves and a few more, as cubic-bezier control points. */
export const EASES = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  'in-out': [0.42, 0, 0.58, 1],
  'expo-in': [0.7, 0, 0.84, 0],
  'expo-out': [0.16, 1, 0.3, 1],
  'expo-in-out': [0.87, 0, 0.13, 1],
  'back-in': [0.36, 0, 0.66, -0.56],
  'back-out': [0.34, 1.56, 0.64, 1],
} as const satisfies Record<string, Bezier>;
export type Bezier = readonly [x1: number, y1: number, x2: number, y2: number];
/** A named curve, cubic-bezier control points (x within 0–1, y free), or n hard steps. */
export type Ease = keyof typeof EASES | Bezier | { steps: number };

/** cubic-bezier(x1, y1, x2, y2) as a function of x, like CSS: Newton's method, bisection when it stalls. */
export function bezier([x1, y1, x2, y2]: Bezier): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = (u: number) => ((ax * u + bx) * u + cx) * u;
  const dX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const Y = (u: number) => ((ay * u + by) * u + cy) * u;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = X(u) - x;
      if (Math.abs(e) < 1e-6) return Y(u);
      const d = dX(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 30; i++) {
      if (X(u) < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return Y(u);
  };
}

export function easeFn(e: Ease): (x: number) => number {
  if (typeof e === 'object' && 'steps' in e) {
    const n = Math.max(1, Math.round(e.steps));
    return (x) => (x >= 1 ? 1 : Math.floor(Math.max(0, x) * n) / n);
  }
  return bezier(typeof e === 'string' ? EASES[e] : e);
}

export interface Transition {
  durationMs: number;
  order: Order;
  ease: Ease;
  /** Width of the moving front, as a share of the run: its cells cross-fade and scramble. */
  edge: number;
  /** Run the order backwards (the shower rises, the center closes in). */
  reverse: boolean;
  /** What the glyphs come from (in) or leave behind (out). */
  backdrop: 'image' | 'pixels' | 'blank';
}

/** Where a transition stands: a cell with threshold t is mixed by cellMix(t, frame). */
export interface TransitionFrame {
  dir: 'in' | 'out';
  /** Eased progress, never going back (an overshooting curve may pass 1 early). */
  p: number;
  edge: number;
  reverse: boolean;
  /** Every cell is glyph (in, done; out, not begun). */
  full: boolean;
  /** No cell is glyph. */
  none: boolean;
}

const LUT = 256;
const monotone = new Map<string, Float32Array>();
/**
 * The ease as the transition uses it: never going back. A curve that dips mid-way would turn a band of cells back
 * and forth (a flash, WCAG 2.3.1), so progress holds at its highest point until the curve passes it again.
 */
export function forwardEase(e: Ease): (x: number) => number {
  const key = JSON.stringify(e);
  let lut = monotone.get(key);
  if (!lut) {
    const f = easeFn(e);
    lut = new Float32Array(LUT + 1);
    let hi = -Infinity;
    for (let i = 0; i <= LUT; i++) lut[i] = hi = Math.max(hi, f(i / LUT));
    monotone.set(key, lut);
  }
  const l = lut;
  return (x) => {
    const u = Math.min(1, Math.max(0, x)) * LUT;
    const i = Math.floor(u);
    return i >= LUT ? l[LUT]! : l[i]! + (l[i + 1]! - l[i]!) * (u - i);
  };
}

export function transitionFrame(tr: Transition, dir: 'in' | 'out', elapsedMs: number): TransitionFrame {
  const x = Math.min(1, Math.max(0, elapsedMs / Math.max(1, tr.durationMs)));
  const p = forwardEase(tr.ease)(x);
  const edge = Math.max(1e-3, tr.edge);
  const glyphs = dir === 'in' ? p : 1 - p; // how far towards all-glyph
  return { dir, p, edge, reverse: tr.reverse, full: glyphs >= 1, none: glyphs <= 0 };
}

/**
 * How far a cell is from its backdrop to its glyph, 0–1, partway while the front crosses it. In, the front sweeps
 * from -edge to 1 turning cells into glyphs; out, it sweeps the same way turning them back, so the first cells in are
 * the first out.
 */
export function cellMix(t: number, f: TransitionFrame): number {
  if (f.full) return 1;
  if (f.none) return 0;
  const tt = f.reverse ? BELOW_ONE - t : t;
  const front = f.p * (1 + f.edge) - f.edge; // where the leading side of the band is
  const k = (front + f.edge - tt) / f.edge; // 1 behind the band, 0 ahead of it
  const m = Math.min(1, Math.max(0, k));
  return f.dir === 'in' ? m : 1 - m;
}

// --- pointer reveal ------------------------------------------------------------------------------------------------

export interface PointerReveal {
  /** Radius of the revealed circle, in CSS px. */
  radius: number;
  /** 0–1: share of the radius over which the reveal fades out (0 a hard edge, 1 soft from the centre). */
  softness: number;
  /** How far the circle lags behind the pointer (ms to close most of the gap); 0 sticks to it. */
  followMs: number;
  /** How long the revealed trail takes to cover over again (ms); 0 leaves no trail. */
  trailMs: number;
}

/**
 * Shortest time a cell takes to uncover, and to cover over again. Below it a pointer wiggling over the same spot would
 * switch photo and glyphs more than three times a second over an area past the WCAG 2.3.1 limit; it holds under
 * reduced motion too (an opacity change, not motion).
 */
export const REVEAL_MIN_MS = 200;

/**
 * One frame of the reveal: each cell rises towards this frame's stamps (`want`) no faster than REVEAL_MIN_MS from 0
 * to 1, and covers over as a trail of `trailMs` (at least REVEAL_MIN_MS). Returns the highest value left, and whether
 * any cell is still on its way.
 */
export function stepReveal(
  field: Float32Array,
  want: Float32Array,
  dtMs: number,
  trailMs: number,
): { max: number; moving: boolean } {
  const rise = dtMs / REVEAL_MIN_MS;
  const keep = Math.exp((-3 * dtMs) / Math.max(REVEAL_MIN_MS, trailMs));
  const fall = dtMs / REVEAL_MIN_MS; // never faster than the floor, even on a long frame
  let max = 0;
  let moving = false;
  for (let i = 0; i < field.length; i++) {
    const v = field[i]!;
    const w = want[i]!;
    let n = w > v ? Math.min(w, v + rise) : Math.max(w, v * keep, v - fall);
    if (n < 0.004) n = 0;
    field[i] = n;
    if (n > max) max = n;
    if (n !== w) moving = true;
  }
  return { max, moving };
}

/** Reveals a soft circle at (x, y) CSS px on a grid of cw × ch px cells: each cell keeps the higher of old and new. */
export function stampReveal(
  field: Float32Array,
  cols: number,
  rows: number,
  cw: number,
  ch: number,
  x: number,
  y: number,
  p: Pick<PointerReveal, 'radius' | 'softness'>,
): void {
  const R = Math.max(1, p.radius);
  const soft = Math.max(1e-3, p.softness);
  const cx0 = Math.max(0, Math.floor((x - R) / cw));
  const cx1 = Math.min(cols - 1, Math.floor((x + R) / cw));
  const cy0 = Math.max(0, Math.floor((y - R) / ch));
  const cy1 = Math.min(rows - 1, Math.floor((y + R) / ch));
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const d = Math.hypot((cx + 0.5) * cw - x, (cy + 0.5) * ch - y) / R;
      if (d >= 1) continue;
      const v = Math.min(1, (1 - d) / soft);
      const i = cy * cols + cx;
      if (v > field[i]!) field[i] = v;
    }
}

/** Stamps along the path from `a` to `b`, so a fast pointer leaves an unbroken trail. */
export function stampPath(
  field: Float32Array,
  cols: number,
  rows: number,
  cw: number,
  ch: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: Pick<PointerReveal, 'radius' | 'softness'>,
): void {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, p.radius * 0.3)));
  for (let s = 1; s <= n; s++)
    stampReveal(field, cols, rows, cw, ch, a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n, p);
}
