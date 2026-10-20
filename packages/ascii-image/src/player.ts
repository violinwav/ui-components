'use client';
import {
  advanceClock,
  autoRows,
  capGrid,
  stepReveal,
  glideFlicker,
  safeFlicker,
  sameFlicker,
  stampPath,
  transitionFrame,
  type Flicker,
  type FlickerClock,
  type PointerReveal,
  type Transition,
  type TransitionFrame,
} from './core';
import { AsciiRenderer, type AsciiFrame, type AsciiStyle, type Backdrop } from './renderer';

export type AsciiMode = 'still' | 'in' | 'out' | 'in-out';
export interface Timeline {
  mode: AsciiMode;
  in: Transition;
  out: Transition;
  /** 'in-out': how long the image stays between the transitions. */
  holdMs: number;
}
export interface PlayerHooks {
  reduced(): boolean;
  /** The canvas has drawn its first frame and owns the picture from now on. */
  onReady(): void;
  /** The last transition left nothing (true), or a new run brings the image back (false). */
  onGone(gone: boolean): void;
  onDone(): void;
}

/** Replays closer together than this are dropped: each snap back to the start is a change of its own (WCAG 2.3.1). */
const MIN_REPLAY_MS = 400;
/** Longest frame step: after a stall the run carries on instead of jumping ahead. */
const MAX_DT = 100;
const STILL: Flicker = { randomness: 0, speed: 0, speedRandomness: 0 };

/**
 * Plays an AsciiImage: one per image, so the image is read once and its glyphs stay put. The timeline, the grid, the
 * look and the flicker can all change while it runs. Frames run only while something moves, the element is on
 * screen and the tab is visible.
 */
export class AsciiPlayer {
  private renderer: AsciiRenderer | null = null;
  private raf = 0;
  private last = 0;
  private visible = false;
  private tl: Timeline | null = null;
  private started = false;
  private elapsed = 0; // ms into the run, advanced by frame steps so a pause simply stops it
  private ended = false; // the last transition ran to its end
  private held = false; // the motion came back on after it was reduced: the image holds, no transition replays
  private wasReduced: boolean;
  private grid: { cols: number; rows?: number } = { cols: 80 };
  private flick: Flicker = STILL; // where the flicker is now
  private flickTo: Flicker = STILL; // where it is gliding to
  private glideMs = 0;
  private allowFlashing = false;
  private playedAt = -Infinity;
  private pending = 0;
  private readonly clock: FlickerClock = { a: 0, b: 0 };
  // the pointer reveal: where the pointer is, where the circle has got to, and the cells it has uncovered
  private hover: PointerReveal | null = null;
  private target: { x: number; y: number } | null = null;
  private pos: { x: number; y: number } | null = null;
  private field = new Float32Array(0); // what shows, per cell
  private want = new Float32Array(0); // what this frame's pointer asks for
  private fieldMax = 0;
  private readonly host: HTMLElement;
  private readonly io: IntersectionObserver;
  private readonly ro: ResizeObserver;
  private destroyed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly img: HTMLImageElement,
    private style: AsciiStyle,
    private readonly hooks: PlayerHooks,
  ) {
    this.wasReduced = hooks.reduced();
    this.host = canvas.parentElement ?? canvas;
    this.host.addEventListener('pointermove', this.onPointer);
    this.host.addEventListener('pointerdown', this.onPointer);
    this.host.addEventListener('pointerleave', this.onLeave);
    this.host.addEventListener('pointercancel', this.onLeave);
    this.host.addEventListener('pointerup', this.onUp);
    this.io = new IntersectionObserver(([e]) => {
      this.visible = !!e?.isIntersecting;
      if (this.visible) this.wake();
    });
    this.io.observe(canvas);
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(canvas);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (img.complete && img.naturalWidth) this.boot();
    else img.addEventListener('load', this.boot, { once: true });
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.pending);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.io.disconnect();
    this.ro.disconnect();
    this.img.removeEventListener('load', this.boot);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.host.removeEventListener('pointermove', this.onPointer);
    this.host.removeEventListener('pointerdown', this.onPointer);
    this.host.removeEventListener('pointerleave', this.onLeave);
    this.host.removeEventListener('pointercancel', this.onLeave);
    this.host.removeEventListener('pointerup', this.onUp);
  }

  /** Reveals the photo around the pointer, or (null) stops. */
  setHover(h: PointerReveal | null): void {
    this.hover = h;
    if (!h) {
      this.field.fill(0);
      this.fieldMax = 0;
      this.target = this.pos = null;
    }
    this.repaint();
  }

  setGrid(cols: number, rows?: number): void {
    this.grid = { cols, rows };
    this.repaint();
  }

  setStyle(style: AsciiStyle): void {
    this.style = style;
    this.renderer?.setStyle(style);
    this.repaint();
  }

  /**
   * Glides the flicker to `f` over `glideMs`; the glyphs on screen carry on from where they are. Its rate is capped
   * to what WCAG 2.3.1 allows for how far the glyphs stray, unless `allowFlashing`.
   */
  setFlicker(f: Flicker | null, glideMs: number, allowFlashing = false): void {
    this.flickTo = f ?? STILL;
    this.glideMs = glideMs;
    this.allowFlashing = allowFlashing;
    if (glideMs <= 0) this.flick = this.flickTo;
    this.wake();
  }

  /** Changes what plays without starting over (a transition under way takes the new settings at once). */
  setTimeline(tl: Timeline): void {
    this.tl = tl;
    this.repaint();
  }

  /** Starts `tl` from its beginning (on screen, now; otherwise when it scrolls in). */
  play(tl: Timeline): void {
    const wait = this.playedAt + MIN_REPLAY_MS - performance.now();
    clearTimeout(this.pending);
    if (this.tl && wait > 0) {
      this.pending = window.setTimeout(() => this.play(tl), wait); // the latest call wins
      return;
    }
    this.playedAt = performance.now();
    this.tl = tl;
    this.started = false;
    this.elapsed = 0;
    this.held = false;
    if (this.ended) this.hooks.onGone(false);
    this.ended = false;
    this.wake();
  }

  /** The motion setting may have changed. */
  motionChanged(): void {
    const reduced = this.hooks.reduced();
    if (reduced === this.wasReduced) return; // the store tells of every setting (theme, sound…)
    this.wasReduced = reduced;
    if (!reduced && !this.ended) this.held = true; // a transition the visitor did not ask for would surprise
    this.wake();
  }

  private readonly onVisibility = () => this.wake();

  private readonly onPointer = (e: PointerEvent) => {
    if (!this.hover) return;
    const r = this.canvas.getBoundingClientRect();
    this.target = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.wake();
  };

  /** A finger lifted is a pointer gone; a mouse button let go is not. */
  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') this.onLeave();
  };

  private readonly onLeave = () => {
    this.target = null;
    this.wake();
  };

  /** Moves the circle towards the pointer and lets the trail cover over. True while anything there still moves. */
  private stepHover(dt: number, cols: number, rows: number): boolean {
    const h = this.hover;
    if (!h) return false;
    if (this.field.length !== cols * rows) {
      this.field = new Float32Array(cols * rows);
      this.want = new Float32Array(cols * rows);
      this.pos = null; // a new grid starts clean
    }
    // reduced motion: the circle sits under the pointer, no lag, no trail; only the opacity floor stays
    const reduced = this.hooks.reduced();
    this.want.fill(0);
    const t = this.target;
    let chasing = false;
    if (t) {
      const from = this.pos ?? t;
      const k = reduced || h.followMs <= 0 ? 1 : 1 - Math.exp((-3 * dt) / h.followMs);
      const to = { x: from.x + (t.x - from.x) * k, y: from.y + (t.y - from.y) * k };
      const r = this.canvas.getBoundingClientRect();
      // the trail is the field covering over; only this frame's stretch of the path is asked for
      stampPath(this.want, cols, rows, r.width / cols, r.height / rows, from, to, h);
      this.pos = to;
      chasing = Math.hypot(t.x - to.x, t.y - to.y) > 0.5;
    } else this.pos = null;
    const { max, moving } = stepReveal(this.field, this.want, dt, reduced ? 0 : h.trailMs);
    this.fieldMax = max;
    return chasing || moving; // a resting pointer over settled cells needs no frames
  }

  private readonly boot = () => {
    if (this.destroyed) return;
    try {
      this.renderer = new AsciiRenderer(this.canvas, this.img, this.style);
    } catch {
      return; // a tainted (cross-origin) image: the <img> stays, which is the picture without the effect
    }
    this.fit();
    this.hooks.onReady();
    void document.fonts?.ready.then(() => {
      this.renderer?.invalidateFont();
      this.repaint();
    });
    this.wake();
  };

  private fit(): void {
    if (!this.renderer) return;
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height, Math.min(2, window.devicePixelRatio || 1));
    this.repaint();
  }

  /** Draws once now when no frames are running (a running loop picks the change up itself). */
  private repaint(): void {
    if (!this.raf) this.paint();
    this.wake();
  }

  private wake(): void {
    if (this.raf || !this.renderer || !this.visible || document.hidden || this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.raf = 0;
    const dt = this.last ? Math.min(MAX_DT, now - this.last) : 0;
    if (!this.started && this.tl && !this.hooks.reduced()) this.started = true;
    if (this.started && !this.hooks.reduced()) this.elapsed += dt;
    if (!sameFlicker(this.flick, this.flickTo))
      this.flick = glideFlicker(this.flick, this.flickTo, dt, this.glideMs);
    const len = [...this.style.ramp].length;
    advanceClock(this.clock, dt / 1000, this.allowFlashing ? this.flick : safeFlicker(this.flick, len));
    let hoverLive = false;
    if (this.renderer && this.hover) {
      const [cols, rows] = this.gridSize(this.renderer);
      hoverLive = this.stepHover(dt, cols, rows);
    }
    const live = this.paint() || hoverLive;
    if (live && this.visible && !document.hidden) {
      this.last = now;
      this.raf = requestAnimationFrame(this.tick);
    } else this.last = 0;
  };

  private gridSize(r: AsciiRenderer): [number, number] {
    return capGrid(this.grid.cols, this.grid.rows ?? autoRows(this.grid.cols, r.aspect));
  }

  /** Draws the current state; true while something still moves. */
  private paint(): boolean {
    const r = this.renderer;
    const tl = this.tl;
    if (!r || !tl) return false;
    const [cols, rows] = this.gridSize(r);
    const reveal = this.hover && this.fieldMax > 0 && this.field.length === cols * rows ? this.field : null;
    const shimmer =
      !sameFlicker(this.flick, this.flickTo) || (this.flick.speed > 0 && this.flick.randomness > 0);
    const frame = (tr: TransitionFrame | null, t: Transition, still = false): AsciiFrame => ({
      cols,
      rows,
      tr,
      order: t.order,
      backdrop: t.backdrop,
      timeS: performance.now() / 1000,
      clock: this.clock,
      randomness: still ? 0 : this.flick.randomness,
      reveal,
    });
    const glyphs = (still = false) => r.draw(frame(null, tl.in, still));
    const backdrop = (t: Transition) => {
      if (t.backdrop === 'pixels') r.draw(frame(transitionFrame(t, 'in', 0), t, true));
      else r.drawBackdrop(t.backdrop as Backdrop);
    };

    if (this.ended) {
      backdrop(tl.out);
      return false;
    }
    if (this.hooks.reduced()) {
      glyphs(true); // §2.8 and WCAG 2.2.2: no transitions, no flicker; the ascii image (never a blank) at once
      return false;
    }
    const e = this.elapsed;
    const { mode } = tl;
    if (!this.started && (mode === 'in' || mode === 'in-out') && !this.held) {
      backdrop(tl.in); // waiting to scroll in: 'in' starts from its backdrop
      return true;
    }
    if (this.held || mode === 'still') {
      glyphs();
      return shimmer;
    }
    if (mode === 'in' || mode === 'in-out') {
      if (e < tl.in.durationMs) {
        r.draw(frame(transitionFrame(tl.in, 'in', e), tl.in));
        return true;
      }
      if (mode === 'in') {
        glyphs();
        return shimmer;
      }
    }
    const outAt = mode === 'out' ? 0 : tl.in.durationMs + tl.holdMs;
    if (e < outAt) {
      glyphs();
      return true; // the hold runs on the clock
    }
    if (e < outAt + tl.out.durationMs) {
      r.draw(frame(transitionFrame(tl.out, 'out', e - outAt), tl.out));
      return true;
    }
    this.ended = true;
    backdrop(tl.out);
    if (tl.out.backdrop === 'blank') this.hooks.onGone(true);
    this.hooks.onDone();
    return false;
  }
}
