'use client';
import {
  buildIntegral,
  cellMix,
  flickerIndex,
  hash2,
  levels,
  luma,
  rampIndex,
  sampleGrid,
  shade,
  stretch,
  thresholds,
  type ColorMode,
  type FlickerClock,
  type Integral,
  type Order,
  type Rgb,
  type Transition,
  type TransitionFrame,
} from './core';

/** Longest side the source is averaged from: past it the cells average the same colours, only slower. */
const SOURCE_PX = 800;
/** How far the front lifts a cell towards white at most: modest, so a pass is never a flash (WCAG 2.3.1). */
const EDGE_LIFT = 0.3;
/** Glyph changes per second in the front's scramble (only cells inside the narrow front). */
const FRONT_HZ = 20;

export type Backdrop = Transition['backdrop'];

export interface AsciiStyle {
  ramp: string;
  color: ColorMode;
  invert: boolean;
}

export interface AsciiFrame {
  cols: number;
  rows: number;
  /** null: every cell is glyph (the still image). */
  tr: TransitionFrame | null;
  order: Order;
  /** What shows where the glyphs are not: the photo, its cell colours as a mosaic, or nothing. */
  backdrop: Backdrop;
  /** Seconds, for the front's scramble. */
  timeS: number;
  clock: FlickerClock;
  randomness: number;
  /** Per cell, 0–1: how much the photo shows through instead of the glyph (the pointer's trail), or null. */
  reveal: Float32Array | null;
}

/** A CSS colour as rgb through the canvas parser, or null when it does not parse. */
export function parseCssColor(css: string): Rgb | null {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000001';
  ctx.fillStyle = css;
  const v = ctx.fillStyle; // '#rrggbb', or 'rgba(r, g, b, a)' for a translucent colour
  if (v === '#000001') return null;
  if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as unknown as Rgb;
  const m = v.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : null;
}

/** Each ramp glyph's coverage (0–255) at one cell size, gw × gh, glyph after glyph. */
interface Masks {
  key: string;
  gw: number;
  gh: number;
  alpha: Uint8Array;
}

/**
 * Draws one frame of an AsciiImage on a 2D canvas. The glyphs are blitted on the CPU into one ImageData, tinted as
 * they are written: one upload a frame, however many cells. (One drawImage per cell made the GPU the bottleneck past
 * ~20k cells.)
 */
export class AsciiRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private integral: Integral;
  private sample = new Float32Array(0);
  private orders = new Map<string, Float32Array>();
  private masks: Masks | null = null;
  private frame: ImageData | null = null;
  /** The photo at canvas size, for the cells the glyphs have not reached. */
  private photo: Uint32Array | null = null;
  private family = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly image: HTMLImageElement,
    private style: AsciiStyle,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.integral = this.readSource();
  }

  get aspect(): number {
    return this.image.naturalHeight / Math.max(1, this.image.naturalWidth);
  }

  setStyle(style: AsciiStyle): void {
    this.style = style;
  }

  /** Sizes the canvas in device pixels. */
  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /** Rebuilds the glyphs on the next draw (after the web font has loaded). */
  invalidateFont(): void {
    this.family = '';
    this.masks = null;
  }

  draw(f: AsciiFrame): void {
    const { cols, rows, tr } = f;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (tr?.none && f.backdrop !== 'pixels') return this.drawBackdrop(f.backdrop);
    const chars = [...this.style.ramp]; // code points, as the masks lay them out
    const len = chars.length;
    this.sample = sampleGrid(this.integral, cols, rows, this.sample);
    const range = levels(this.sample);
    const t = tr && !tr.full && !tr.none ? this.order(cols, rows, f.order) : null;
    const cw = W / cols;
    const ch = H / rows;
    const { gw, gh, alpha } = this.glyphMasks(
      Math.max(1, Math.floor(cw)),
      Math.max(1, Math.floor(ch)),
      chars,
    );
    const img = this.frameBuffer(W, H);
    const out = new Uint32Array(img.data.buffer);
    out.fill(0);
    const reveal = f.reveal?.length === cols * rows ? f.reveal : null;
    const photo = (f.backdrop === 'image' && tr && !tr.full) || reveal ? this.photoAt(W, H) : null;
    const scramble = Math.floor(f.timeS * FRONT_HZ);

    for (let y = 0, i = 0; y < rows; y++) {
      const y0 = Math.round(y * ch);
      const y1 = Math.round((y + 1) * ch);
      const gy = y0 + ((y1 - y0 - gh) >> 1);
      for (let x = 0; x < cols; x++, i++) {
        const x0 = Math.round(x * cw);
        const x1 = Math.round((x + 1) * cw);
        const kt = tr ? (t ? cellMix(t[i]!, tr) : tr.none ? 0 : 1) : 1; // the transition's glyph share
        const rv = reveal ? reveal[i]! : 0; // the pointer's
        const k = kt * (1 - rv);
        const r = this.sample[i * 3]!;
        const g = this.sample[i * 3 + 1]!;
        const b = this.sample[i * 3 + 2]!;
        if (k < 1) {
          // what shows where the glyph does not: the backdrop as the transition leaves it, the photo where the pointer is
          if (f.backdrop === 'image') {
            copyFaded(out, photo!, W, x0, x1, y0, y1, 1 - k);
          } else {
            if (f.backdrop === 'pixels' && kt < 1) {
              const block =
                (Math.round((1 - kt) * 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
              for (let py = y0; py < y1; py++) out.fill(block, py * W + x0, py * W + x1);
            }
            if (rv > 0) {
              const a = rv * kt;
              if (f.backdrop === 'blank' || kt >= 1) copyFaded(out, photo!, W, x0, x1, y0, y1, a);
              else
                for (let py = y0; py < y1; py++)
                  for (let px = py * W + x0, end = py * W + x1; px < end; px++) {
                    const s = photo![px]!;
                    out[px] = over(out[px]!, s & 255, (s >>> 8) & 255, (s >>> 16) & 255, a);
                  }
            }
          }
        }
        if (k <= 0) continue;
        const ls = stretch(luma(r, g, b), range);
        const base = rampIndex(ls, len, this.style.invert);
        let [cr, cg, cb] = shade(r, g, b, this.style.color, this.style.invert ? 1 - ls : ls);
        let idx: number;
        if (kt < 1) {
          // the front: glyphs scramble around their own, ±2 steps, so each change stays small (WCAG 2.3.1)
          idx = Math.min(len - 1, Math.max(1, base + Math.round((hash2(i, scramble) * 2 - 1) * 2)));
          const lift = EDGE_LIFT * (1 - Math.abs(2 * kt - 1));
          cr += (255 - cr) * lift;
          cg += (255 - cg) * lift;
          cb += (255 - cb) * lift;
        } else {
          idx = flickerIndex(i, base, len, f.clock, f.randomness);
        }
        if (chars[idx] === ' ') continue;
        const gx = x0 + ((x1 - x0 - gw) >> 1);
        const at = idx * gw * gh;
        if (k >= 1) {
          // ImageData is RGBA in memory: little-endian ABGR as a Uint32
          const rgb = ((cb & 255) << 16) | ((cg & 255) << 8) | (cr & 255);
          for (let py = 0; py < gh; py++) {
            const row = (gy + py) * W + gx;
            const src = at + py * gw;
            for (let px = 0; px < gw; px++) {
              const a = alpha[src + px]!;
              if (a) out[row + px] = (a << 24) | rgb;
            }
          }
        } else {
          for (let py = 0; py < gh; py++) {
            const row = (gy + py) * W + gx;
            const src = at + py * gw;
            for (let px = 0; px < gw; px++) {
              const a = alpha[src + px]!;
              if (a) out[row + px] = over(out[row + px]!, cr, cg, cb, (a * k) / 255);
            }
          }
        }
      }
    }
    this.ctx.putImageData(img, 0, 0);
  }

  /** The backdrop alone (a mosaic is drawn through draw()). */
  drawBackdrop(backdrop: Backdrop): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (backdrop === 'image') {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.image, 0, 0, canvas.width, canvas.height);
    }
  }

  private readSource(): Integral {
    const { naturalWidth: w0, naturalHeight: h0 } = this.image;
    const k = Math.min(1, SOURCE_PX / Math.max(w0, h0, 1));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const cx = scratch(w, h);
    cx.drawImage(this.image, 0, 0, w, h);
    return buildIntegral(cx.getImageData(0, 0, w, h).data, w, h); // throws on a cross-origin image without CORS
  }

  private frameBuffer(W: number, H: number): ImageData {
    if (this.frame?.width !== W || this.frame.height !== H) this.frame = this.ctx.createImageData(W, H);
    return this.frame;
  }

  private photoAt(W: number, H: number): Uint32Array {
    if (this.photo?.length !== W * H) {
      const cx = scratch(W, H);
      cx.drawImage(this.image, 0, 0, W, H);
      this.photo = new Uint32Array(cx.getImageData(0, 0, W, H).data.buffer);
    }
    return this.photo;
  }

  private order(cols: number, rows: number, order: Order): Float32Array {
    const key = `${cols}x${rows}|${order}`;
    let t = this.orders.get(key);
    if (!t) {
      if (this.orders.size > 8) this.orders.clear();
      t = thresholds(cols, rows, order, this.aspect);
      this.orders.set(key, t);
    }
    return t;
  }

  /** The ramp's glyphs rasterised at gw × gh in the canvas's own (CSS) font, kept until the cell size changes. */
  private glyphMasks(gw: number, gh: number, chars: string[]): Masks {
    this.family ||= getComputedStyle(this.canvas).fontFamily || 'monospace';
    const key = `${gw}x${gh}|${this.family}|${chars.join('')}`;
    if (this.masks?.key === key) return this.masks;
    const cx = scratch(gw * chars.length, gh);
    cx.font = `100px ${this.family}`;
    const adv = Math.max(...chars.map((c) => cx.measureText(c).width), 1) / 100; // widest advance per px of size
    cx.font = `${Math.max(1, Math.min(gh, gw / adv))}px ${this.family}`;
    cx.fillStyle = '#fff';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    chars.forEach((c, i) => cx.fillText(c, i * gw + gw / 2, gh / 2));
    const rgba = cx.getImageData(0, 0, gw * chars.length, gh).data;
    const alpha = new Uint8Array(gw * gh * chars.length);
    // glyph-major: glyph i's row y is at i·gw·gh + y·gw
    for (let i = 0; i < chars.length; i++)
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++)
          alpha[i * gw * gh + y * gw + x] = rgba[(y * gw * chars.length + i * gw + x) * 4 + 3]!;
    this.masks = { key, gw, gh, alpha };
    return this.masks;
  }
}

/** Copies the photo's block into `out` at opacity `a` (0–1). */
function copyFaded(
  out: Uint32Array,
  photo: Uint32Array,
  W: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  a: number,
) {
  if (a >= 1) {
    for (let py = y0; py < y1; py++) out.set(photo.subarray(py * W + x0, py * W + x1), py * W + x0);
    return;
  }
  const keep = Math.round(a * 255);
  for (let py = y0; py < y1; py++)
    for (let px = py * W + x0, end = py * W + x1; px < end; px++)
      out[px] = ((((photo[px]! >>> 24) * keep) / 255) << 24) | (photo[px]! & 0xffffff);
}

/** `dst` (an ABGR word) with an rgb colour laid over it at opacity `a` (0–1): Porter–Duff "over", unpremultiplied. */
function over(dst: number, r: number, g: number, b: number, a: number): number {
  const da = (dst >>> 24) / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return 0;
  const w = da * (1 - a);
  const mix = (c: number, d: number) => Math.round((c * a + d * w) / oa) & 255;
  return (
    (Math.round(oa * 255) << 24) |
    (mix(b, (dst >>> 16) & 255) << 16) |
    (mix(g, (dst >>> 8) & 255) << 8) |
    mix(r, dst & 255)
  );
}

let scratchCanvas: HTMLCanvasElement | null = null;
/** A shared offscreen 2D context, cleared and sized for one read. */
function scratch(w: number, h: number): CanvasRenderingContext2D {
  scratchCanvas ??= document.createElement('canvas');
  scratchCanvas.width = w;
  scratchCanvas.height = h; // also clears it and resets its state
  return scratchCanvas.getContext('2d', { willReadFrequently: true })!;
}
