import { systemMotion, type MotionSource } from '@ui-components/ascii-image';

/** The OS setting, plus the playground's checkbox standing in for a site's own motion toggle. */
let forced: boolean | null = null;
const listeners = new Set<() => void>();

export const playgroundMotion: MotionSource = {
  reduced: () => forced ?? systemMotion.reduced(),
  subscribe(onChange) {
    listeners.add(onChange);
    const off = systemMotion.subscribe(onChange);
    return () => {
      listeners.delete(onChange);
      off();
    };
  },
};

export function forceReducedMotion(on: boolean | null): void {
  forced = on;
  listeners.forEach((l) => l());
}
