// src/components/ui/AsciiImage.tsx
'use client';
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react';
import { DEFAULT_RAMP, type ColorMode, type Flicker, type PointerReveal, type Transition } from './core';
import { systemMotion, type MotionSource } from './motion';
import { AsciiPlayer, type AsciiMode, type Timeline } from './player';
import { parseCssColor } from './renderer';
import './ascii-image.css';

export type { AsciiMode } from './player';
export type AsciiTransition = Partial<Transition>;

export interface AsciiImageHandle {
  /** Starts the timeline over, in `mode` if given (otherwise the prop's). */
  play(mode?: AsciiMode): void;
  /** Glides the flicker to new settings without a render; the glyphs on screen carry on. */
  setFlicker(f: Partial<Flicker> | false, glideMs?: number): void;
}

export interface AsciiImageProps {
  /** A URL or a static import. A cross-origin URL needs CORS: the colours are read from its pixels. */
  src: string | { src: string; width: number; height: number };
  /** What the image shows (not "ASCII art"). '' marks it decorative. */
  alt: string;
  /** Characters per row. Default 80. */
  cols?: number;
  /** Characters per column. Default: from the image's aspect and the glyph's. */
  rows?: number;
  /** 'original', 'grey', or any CSS colour to tint the brightness with. */
  color?: 'original' | 'grey' | (string & {});
  /** Glyphs from empty to densest. */
  ramp?: string;
  /** Dense glyphs on the dark parts, for a light ground. */
  invert?: boolean;
  /** 'still' shows the characters; 'in' turns the image into them; 'out' turns them back; 'in-out' both. */
  mode?: AsciiMode;
  /** The glyphs' constant shimmer, or false. A change glides over `flickerGlideMs`; it never starts anything over. */
  flicker?: Partial<Flicker> | false;
  flickerGlideMs?: number;
  /**
   * Lifts the WCAG 2.3.1 cap on the flicker's rate (6/s within one density step, 3/s beyond). Only for a page that
   * has been through a flash analyser (PEAT) with these settings.
   */
  allowFlashing?: boolean;
  fadeIn?: AsciiTransition;
  fadeOut?: AsciiTransition;
  /** 'in-out': how long the characters stay between the transitions. */
  holdMs?: number;
  /**
   * The photo kept behind the characters: its opacity (0–1) and any CSS filter, e.g. `grayscale(1)` under
   * coloured glyphs, or `blur(2px) brightness(.5)`.
   */
  underlay?: { opacity?: number; filter?: string } | false;
  /** Reveals the photo around the pointer: radius (px), edge softness, follow lag and trail (ms). */
  hover?: Partial<PointerReveal> | false;
  /**
   * Where the reduced-motion preference comes from. Default: the OS setting. A site with its own motion toggle passes
   * its store here, so the component follows it too. Keep it stable (a module constant): it is read on mount.
   */
  motion?: MotionSource;
  className?: string;
  /** After the last transition (never for 'still', nor 'in', which holds). */
  onDone?: () => void;
  ref?: Ref<AsciiImageHandle>;
}

/** Within WCAG 2.3.1: a glyph moves about one density step at a time, three times a second, each cell on its own clock. */
export const DEFAULT_FLICKER: Flicker = { randomness: 0.1, speed: 3, speedRandomness: 0.5 };
export const DEFAULT_IN: Transition = {
  durationMs: 1800,
  order: 'center',
  ease: 'in-out',
  edge: 0.15,
  reverse: false,
  backdrop: 'image',
};
export const DEFAULT_OUT: Transition = { ...DEFAULT_IN, order: 'shower' };
export const DEFAULT_HOVER: PointerReveal = { radius: 80, softness: 0.6, followMs: 120, trailMs: 600 };

export function AsciiImage({
  src,
  alt,
  cols = 80,
  rows,
  color = 'original',
  ramp = DEFAULT_RAMP,
  invert = false,
  mode = 'still',
  flicker,
  flickerGlideMs = 400,
  allowFlashing = false,
  fadeIn,
  fadeOut,
  holdMs = 2000,
  underlay = false,
  hover = false,
  motion = systemMotion,
  className,
  onDone,
  ref,
}: AsciiImageProps) {
  const img = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<AsciiPlayer | null>(null);
  const [drawn, setDrawn] = useState(false); // the canvas owns the picture from its first frame on
  const [gone, setGone] = useState(false); // the last transition left nothing: the name would describe what is not there
  const url = typeof src === 'string' ? src : src.src;

  // Every prop reaches the player through its own setter, so a change applies in place. Only a new image makes a
  // new player, and only a new mode (or play()) starts the timeline over.
  const timeline = (m: AsciiMode = mode): Timeline => ({
    mode: m,
    in: { ...DEFAULT_IN, ...fadeIn },
    out: { ...DEFAULT_OUT, ...fadeOut },
    holdMs,
  });
  const look = () => ({ ramp, invert, color: tintOf(color) });
  const pointer = () => (hover === false ? null : { ...DEFAULT_HOVER, ...hover });
  const props = {
    timeline,
    look,
    pointer,
    flicker,
    flickerGlideMs,
    allowFlashing,
    cols,
    rows,
    onDone,
    motion,
  };
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const L = latest.current;
    const p = new AsciiPlayer(canvas.current!, img.current!, L.look(), {
      reduced: () => latest.current.motion.reduced(),
      onReady: () => setDrawn(true),
      onGone: setGone,
      onDone: () => latest.current.onDone?.(),
    });
    p.setGrid(L.cols, L.rows);
    p.setHover(L.pointer());
    p.setFlicker(withDefaults(L.flicker), 0, L.allowFlashing);
    p.play(L.timeline());
    player.current = p;
    const unsubscribe = L.motion.subscribe(() => p.motionChanged());
    return () => {
      unsubscribe();
      p.destroy();
      player.current = null;
    };
  }, [url]);

  useEffect(() => player.current?.setGrid(cols, rows), [cols, rows]);

  // the keys stand for the props each effect reads through `latest`
  const lookKey = JSON.stringify([color, ramp, invert]);
  useEffect(() => player.current?.setStyle(latest.current.look()), [lookKey]);

  const flickerKey = JSON.stringify([flicker, allowFlashing]);
  useEffect(() => {
    const L = latest.current;
    player.current?.setFlicker(withDefaults(L.flicker), L.flickerGlideMs, L.allowFlashing);
  }, [flickerKey]);

  const hoverKey = JSON.stringify(hover);
  useEffect(() => player.current?.setHover(latest.current.pointer()), [hoverKey]);

  const timelineKey = JSON.stringify([fadeIn, fadeOut, holdMs]);
  useEffect(() => player.current?.setTimeline(latest.current.timeline()), [timelineKey]);

  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current)
      firstMode.current = false; // the player started it
    else player.current?.play(latest.current.timeline());
  }, [mode]);

  useImperativeHandle(
    ref,
    () => ({
      play: (m) => player.current?.play(latest.current.timeline(m)),
      setFlicker: (f, glideMs) => {
        const L = latest.current;
        const next = f === false ? null : withDefaults({ ...(L.flicker || {}), ...f });
        player.current?.setFlicker(next, glideMs ?? L.flickerGlideMs, L.allowFlashing);
      },
    }),
    [],
  );

  const under = underlay ? { opacity: underlay.opacity ?? 0.35, filter: underlay.filter ?? 'none' } : null;
  const decorative = alt === '' || (gone && !under?.opacity); // an underlay still shows the photo
  const dims = typeof src === 'string' ? {} : { width: src.width, height: src.height };
  return (
    <div
      className={['ascii-image', className].filter(Boolean).join(' ')}
      data-drawn={drawn ? '' : undefined}
      data-underlay={under ? '' : undefined}
      style={
        under
          ? ({ '--ascii-image-under': under.opacity, '--ascii-image-filter': under.filter } as CSSProperties)
          : undefined
      }
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': alt })}
    >
      {/* the server-rendered picture (no JS, LCP), and the source the canvas reads its colours from */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={img} src={url} alt="" aria-hidden="true" crossOrigin="anonymous" decoding="async" {...dims} />
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}

const withDefaults = (f: Partial<Flicker> | false | undefined): Flicker | null =>
  f === false ? null : { ...DEFAULT_FLICKER, ...f };

function tintOf(color: string): ColorMode {
  if (color === 'original') return 'original';
  if (color === 'grey') return 'grey';
  return typeof document === 'undefined' ? 'grey' : (parseCssColor(color) ?? 'grey');
}
