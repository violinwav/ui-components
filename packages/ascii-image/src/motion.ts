'use client';

/**
 * Where an AsciiImage learns whether to move. `reduced()` is read on every frame decision, `subscribe` tells it when
 * the answer may have changed (it checks, so extra calls are harmless).
 */
export interface MotionSource {
  reduced(): boolean;
  subscribe(onChange: () => void): () => void;
}

const QUERY = '(prefers-reduced-motion: reduce)';

/** The OS setting (prefers-reduced-motion). */
export const systemMotion: MotionSource = {
  reduced: () => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches,
  subscribe(onChange) {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mql = window.matchMedia(QUERY);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  },
};
