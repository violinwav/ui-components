# @ui-components/ascii-image

Turns an image into a grid of coloured characters. Each cell is the box average of the pixels under it. The cell's brightness picks a glyph from a density ramp, and its colour tints that glyph. It turns a photo into characters and back with a choice of transitions and easing curves, or it sits still with characters that keep switching. The photo can stay behind the characters, and a pointer can uncover it.

The package ships TypeScript source (no build step). Any bundler that compiles TS from dependencies handles it: Vite does out of the box, and Next.js does with `transpilePackages`.

## Install

From this repository (pnpm can install a single workspace package straight from git):

```bash
pnpm add "github:violinwav/ui-components#main&path:packages/ascii-image"
```

In Next.js, add the package to `transpilePackages` in `next.config.ts`:

```ts
export default { transpilePackages: ['@ui-components/ascii-image'] };
```

The component imports its own stylesheet. If your setup strips CSS imports from dependencies, import `@ui-components/ascii-image/styles.css` once yourself.

## Use

```tsx
import { AsciiImage, type AsciiImageHandle } from '@ui-components/ascii-image';
import photo from '@/assets/hero.jpg';

const ascii = useRef<AsciiImageHandle>(null);

<AsciiImage
  ref={ascii}
  src={photo}
  alt="The studio desk at dusk"
  mode="in"
  cols={100}
  fadeIn={{ order: 'glitch', ease: [0.16, 1, 0.3, 1], durationMs: 2000, backdrop: 'image' }}
/>;

ascii.current?.setFlicker({ speed: 5 }, 800); // glides there, no re-render, same glyphs
ascii.current?.play('out'); // chars → image
```

## Motion settings

By default the component follows the OS reduced-motion setting. A site with its own motion toggle passes it in through `motion`. Here is viodev's settings store, which also follows the HUD toggle:

```ts
// viodev: src/components/ui/asciiMotion.ts
import type { MotionSource } from '@ui-components/ascii-image';
import { effectiveMotion, subscribe } from '@/lib/settings';

export const viodevMotion: MotionSource = { reduced: () => effectiveMotion() === 'reduced', subscribe };
```

```tsx
<AsciiImage motion={viodevMotion} … />
```

## Props

| Prop                 | Default                    | Notes                                                                                                                 |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src`                | —                          | URL or static import. Cross-origin images need CORS, because the pixels are read.                                     |
| `alt`                | — (required)               | Describe the subject. Pass `''` if the image is decorative.                                                           |
| `cols` / `rows`      | `80` / auto                | x / y. Fixed; changing them applies in place.                                                                         |
| `color`              | `'original'`               | `'grey'`, or any CSS colour to get a one-colour tint.                                                                 |
| `ramp`, `invert`     | `' .,:;i1tfLCG08@'`, false | `invert` is for light backgrounds.                                                                                    |
| `mode`               | `'still'`                  | `'in'` (image → chars), `'out'` (chars → image), `'in-out'`.                                                          |
| `flicker`            | `{0.1, 3/s, 0.5}`          | `{ randomness, speed, speedRandomness }`, or `false`.                                                                 |
| `flickerGlideMs`     | `400`                      | How long a flicker change takes to settle.                                                                            |
| `allowFlashing`      | `false`                    | Lifts the flash-safety cap on flicker speed. Only after a PEAT run.                                                   |
| `fadeIn` / `fadeOut` | see below                  | `{ order, ease, durationMs, edge, reverse, backdrop }`                                                                |
| `holdMs`             | `2000`                     | How long the characters stay between the transitions in `'in-out'`.                                                   |
| `underlay`           | `false`                    | `{ opacity, filter }`: the photo stays behind the chars at that opacity, with any CSS filter (e.g. `grayscale(1)`).   |
| `motion`             | `systemMotion`             | Where reduced motion comes from (see above).                                                                          |
| `hover`              | `false`                    | `{ radius, softness, followMs, trailMs }`: reveals the photo around the pointer. Defaults 80 px, 0.6, 120 ms, 600 ms. |
| `ref`                | —                          | `play(mode?)` restarts; `setFlicker(patch, glideMs?)` automates the flicker.                                          |

Transition options:

- **`order`**: `center`, `shower`, `random`, `scan`, `raster`, `wipe`, `diagonal`, `interlace`, `bayer`, `blocks`, `glitch`, `spiral`.
- **`ease`**: a name (`linear`, `ease`, `in`, `out`, `in-out`, `expo-*`, `back-*`), cubic-bezier points `[x1, y1, x2, y2]`, or `{ steps: n }`.
- **`edge`**: width of the moving front (0–1). Cells inside it cross-fade from the backdrop and scramble.
- **`reverse`**: runs the order backwards.
- **`backdrop`**: what the chars come from or leave behind: `image`, `pixels` (cell-colour mosaic) or `blank`.

Defaults: 1800 ms, `in-out`, edge 0.15, photo backdrop. Fade-in uses `center`, fade-out uses `shower`.

## Behaviour

- **One player per image.** The image is read once. Changes to the grid, look, flicker and transition settings apply in place. Only a new `mode` or `play()` starts the timeline over.
- **The flicker clock is integrated.** Changing speed (by prop, `setFlicker` or a sweep) only changes how fast glyphs move from now on, and never swaps the glyphs on screen.
- **Flash safety (WCAG 2.3.1).**
  - Flicker is capped at 6 changes/s while it stays within one density step, and at 3/s beyond that.
  - The front scramble stays within ±2 density steps.
  - Progress never goes backwards within a pass, even on a curve that dips.
  - Replays are spaced at least 400 ms apart.
- **Mouse reveal.**
  - A soft circle around the pointer shows the photo instead of the chars. It follows with `followMs` of lag and leaves a trail that covers over in `trailMs`.
  - A cell never uncovers or covers over in under 200 ms (WCAG 2.3.1), however small `trailMs` is.
  - Touch drags work, but the reveal never blocks scrolling or pinch-zoom.
  - The reveal is clipped to the image.
  - Under reduced motion it sits right under the pointer, with no lag and no trail.
- **Underlay.** The underlay is the server-rendered `<img>` itself, so it costs no canvas time. While it is visible, the wrapper keeps its `alt` text even after a transition leaves the canvas blank.
- **Reduced motion.** There are no transitions and no flicker; the static ASCII image shows straight away. If the setting is switched back on, the flicker resumes but the transition does not replay.
- **Pausing.** The animation pauses when the image is offscreen or the tab is hidden, and continues where it stopped.
- **Accessibility.** The wrapper has `role="img"` plus the `alt` text, and the `<img>` and `<canvas>` are `aria-hidden`. If the last transition leaves nothing on screen, the wrapper becomes `aria-hidden`.
- **Not yet done.** The worst-case settings (glitch, blocks, random, in-out at short durations, maximum automation) still need a run through PEAT, and this still needs measuring on the HD 620.
