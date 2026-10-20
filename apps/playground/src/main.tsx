import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AsciiImage,
  DEFAULT_FLICKER,
  DEFAULT_HOVER,
  DEFAULT_IN,
  DEFAULT_OUT,
  easeFn,
  ORDERS,
  type AsciiImageHandle,
  type AsciiMode,
  type Ease,
  type Order,
  type Transition,
} from '@ui-components/ascii-image';
import { CurveEditor } from './CurveEditor';
import { forceReducedMotion, playgroundMotion } from './motion';
import './playground.css';

const FILTERS = [
  'none',
  'grayscale(1)',
  'grayscale(1) brightness(0.6)',
  'blur(3px)',
  'blur(2px) grayscale(1)',
  'sepia(1) brightness(0.7)',
  'contrast(1.6) saturate(0)',
  'invert(1)',
];

const DEFAULT_SRC = 'https://picsum.photos/id/1025/900/600'; // the blanket ghost

function Num(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  on: (v: number) => void;
}) {
  return (
    <label>
      <span>
        {p.label} <output>{p.value}</output>
      </span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step ?? 1}
        value={p.value}
        onChange={(e) => p.on(Number(e.target.value))}
      />
    </label>
  );
}

function TransitionControls({
  title,
  value,
  on,
}: {
  title: string;
  value: Transition;
  on: (t: Transition) => void;
}) {
  const set = (patch: Partial<Transition>) => on({ ...value, ...patch });
  return (
    <fieldset>
      <legend>{title}</legend>
      <label>
        <span>Order</span>
        <select value={value.order} onChange={(e) => set({ order: e.target.value as Order })}>
          {ORDERS.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
      <CurveEditor label="Easing" value={value.ease} onChange={(ease) => set({ ease })} />
      <Num
        label="Duration (ms)"
        value={value.durationMs}
        min={300}
        max={8000}
        step={100}
        on={(v) => set({ durationMs: v })}
      />
      <Num
        label="Front width"
        value={value.edge}
        min={0.01}
        max={0.6}
        step={0.01}
        on={(v) => set({ edge: v })}
      />
      <label>
        <span>Backdrop</span>
        <select
          value={value.backdrop}
          onChange={(e) => set({ backdrop: e.target.value as Transition['backdrop'] })}
        >
          <option value="image">photo</option>
          <option value="pixels">pixel mosaic</option>
          <option value="blank">blank</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={value.reverse} onChange={(e) => set({ reverse: e.target.checked })} />{' '}
        Reverse order
      </label>
    </fieldset>
  );
}

function App() {
  const ascii = useRef<AsciiImageHandle>(null);
  const [src, setSrc] = useState(DEFAULT_SRC);
  const [bg, setBg] = useState('#07080a');
  const [mode, setMode] = useState<AsciiMode>('in');
  const [cols, setCols] = useState(100);
  const [color, setColor] = useState<'original' | 'grey' | 'tint'>('original');
  const [tint, setTint] = useState('#7cf5c4');
  const [invert, setInvert] = useState(false);
  const [ramp, setRamp] = useState(' .,:;i1tfLCG08@');
  const [fIn, setFIn] = useState<Transition>({
    ...DEFAULT_IN,
    order: 'center',
    ease: 'expo-out',
    durationMs: 2200,
  });
  const [fOut, setFOut] = useState<Transition>({
    ...DEFAULT_OUT,
    order: 'glitch',
    ease: { steps: 8 },
    durationMs: 1600,
  });
  const [holdMs, setHoldMs] = useState(2500);
  const [flick, setFlick] = useState({ on: true, ...DEFAULT_FLICKER });
  const [glideMs, setGlideMs] = useState(400);
  const [allowFlashing, setAllowFlashing] = useState(false);
  const [sweep, setSweep] = useState({ on: false, min: 0.5, max: 6, periodMs: 4000, ease: 'in-out' as Ease });
  const [reduced, setReduced] = useState(false);
  const [under, setUnder] = useState({ on: true, opacity: 0.35, filter: 'grayscale(1)' });
  const [hover, setHover] = useState({ on: true, ...DEFAULT_HOVER });

  // automation: the speed swept on every frame through the handle, with no render of the component
  useEffect(() => {
    if (!sweep.on || !flick.on) return;
    const f = easeFn(sweep.ease);
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const phase = ((now - t0) / sweep.periodMs) % 2;
      const x = phase < 1 ? phase : 2 - phase; // there and back
      ascii.current?.setFlicker({ speed: sweep.min + (sweep.max - sweep.min) * f(x) }, 0);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [sweep, flick.on]);

  // a new mode starts itself; the same mode again is a replay
  const play = (m: AsciiMode) => (m === mode ? ascii.current?.play(m) : setMode(m));

  return (
    <main style={{ background: bg }}>
      <section className="stage">
        <AsciiImage
          ref={ascii}
          motion={playgroundMotion}
          src={src}
          alt="A dog wrapped in a white blanket, sitting on a forest path"
          mode={mode}
          cols={cols}
          color={color === 'tint' ? tint : color}
          invert={invert}
          ramp={ramp || ' .:-=+*#%@'}
          flicker={
            flick.on
              ? { randomness: flick.randomness, speed: flick.speed, speedRandomness: flick.speedRandomness }
              : false
          }
          flickerGlideMs={glideMs}
          allowFlashing={allowFlashing}
          fadeIn={fIn}
          fadeOut={fOut}
          holdMs={holdMs}
          underlay={under.on && { opacity: under.opacity, filter: under.filter }}
          hover={
            hover.on && {
              radius: hover.radius,
              softness: hover.softness,
              followMs: hover.followMs,
              trailMs: hover.trailMs,
            }
          }
        />
        <div className="transport">
          <button type="button" aria-pressed={mode === 'in'} onClick={() => play('in')}>
            Image → chars
          </button>
          <button type="button" aria-pressed={mode === 'out'} onClick={() => play('out')}>
            Chars → image
          </button>
          <button type="button" aria-pressed={mode === 'in-out'} onClick={() => play('in-out')}>
            In → hold → out
          </button>
          <button type="button" aria-pressed={mode === 'still'} onClick={() => play('still')}>
            Still
          </button>
        </div>
      </section>
      <aside className="panel">
        <h1>AsciiImage</h1>
        <fieldset>
          <legend>Page</legend>
          <label className="row">
            <span>Background</span>
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
            <code>{bg}</code>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => {
                setReduced(e.target.checked);
                forceReducedMotion(e.target.checked || null);
              }}
            />{' '}
            Reduced motion (stands in for the HUD toggle)
          </label>
        </fieldset>
        <fieldset>
          <legend>Image</legend>
          <label>
            <span>URL (needs CORS)</span>
            <input value={src} onChange={(e) => setSrc(e.target.value)} />
          </label>
          <label>
            <span>File</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && setSrc(URL.createObjectURL(e.target.files[0]))}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Characters</legend>
          <Num label="Columns (x)" value={cols} min={10} max={240} on={setCols} />
          <label>
            <span>Ramp (empty → dense)</span>
            <input value={ramp} onChange={(e) => setRamp(e.target.value)} spellCheck={false} />
          </label>
          <label>
            <span>Colour</span>
            <select value={color} onChange={(e) => setColor(e.target.value as typeof color)}>
              <option value="original">original</option>
              <option value="grey">greyscale</option>
              <option value="tint">one colour</option>
            </select>
          </label>
          {color === 'tint' && (
            <label className="row">
              <span>Tint</span>
              <input type="color" value={tint} onChange={(e) => setTint(e.target.value)} />
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Invert
            ramp (light backgrounds)
          </label>
        </fieldset>
        <fieldset>
          <legend>Photo behind the chars</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={under.on}
              onChange={(e) => setUnder({ ...under, on: e.target.checked })}
            />{' '}
            On
          </label>
          <Num
            label="Opacity"
            value={under.opacity}
            min={0}
            max={1}
            step={0.05}
            on={(v) => setUnder({ ...under, opacity: v })}
          />
          <label>
            <span>Filter preset</span>
            <select
              value={FILTERS.includes(under.filter) ? under.filter : ''}
              onChange={(e) => setUnder({ ...under, filter: e.target.value || under.filter })}
            >
              {FILTERS.map((f) => (
                <option key={f}>{f}</option>
              ))}
              <option value="">custom</option>
            </select>
          </label>
          <label>
            <span>CSS filter</span>
            <input
              value={under.filter}
              onChange={(e) => setUnder({ ...under, filter: e.target.value })}
              spellCheck={false}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Mouse reveal</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={hover.on}
              onChange={(e) => setHover({ ...hover, on: e.target.checked })}
            />{' '}
            On
          </label>
          <Num
            label="Radius (px)"
            value={hover.radius}
            min={10}
            max={300}
            on={(v) => setHover({ ...hover, radius: v })}
          />
          <Num
            label="Edge softness"
            value={hover.softness}
            min={0}
            max={1}
            step={0.05}
            on={(v) => setHover({ ...hover, softness: v })}
          />
          <Num
            label="Follow lag (ms)"
            value={hover.followMs}
            min={0}
            max={1500}
            step={10}
            on={(v) => setHover({ ...hover, followMs: v })}
          />
          <Num
            label="Trail (ms)"
            value={hover.trailMs}
            min={0}
            max={4000}
            step={50}
            on={(v) => setHover({ ...hover, trailMs: v })}
          />
        </fieldset>
        <fieldset>
          <legend>Char flicker</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={flick.on}
              onChange={(e) => setFlick({ ...flick, on: e.target.checked })}
            />{' '}
            On
          </label>
          <Num
            label="Randomness"
            value={flick.randomness}
            min={0}
            max={1}
            step={0.05}
            on={(v) => setFlick({ ...flick, randomness: v })}
          />
          <Num
            label="Speed (/s)"
            value={flick.speed}
            min={0}
            max={12}
            step={0.25}
            on={(v) => setFlick({ ...flick, speed: v })}
          />
          <Num
            label="Speed randomness"
            value={flick.speedRandomness}
            min={0}
            max={1}
            step={0.05}
            on={(v) => setFlick({ ...flick, speedRandomness: v })}
          />
          <Num label="Glide (ms)" value={glideMs} min={0} max={3000} step={50} on={setGlideMs} />
          <label className="check">
            <input
              type="checkbox"
              checked={allowFlashing}
              onChange={(e) => setAllowFlashing(e.target.checked)}
            />{' '}
            Lift the flash-safety cap (testing only)
          </label>
        </fieldset>
        <fieldset>
          <legend>Automate flicker speed</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={sweep.on}
              onChange={(e) => setSweep({ ...sweep, on: e.target.checked })}
            />{' '}
            Sweep
          </label>
          <Num
            label="From (/s)"
            value={sweep.min}
            min={0}
            max={12}
            step={0.25}
            on={(v) => setSweep({ ...sweep, min: v })}
          />
          <Num
            label="To (/s)"
            value={sweep.max}
            min={0}
            max={12}
            step={0.25}
            on={(v) => setSweep({ ...sweep, max: v })}
          />
          <Num
            label="Period (ms)"
            value={sweep.periodMs}
            min={500}
            max={10000}
            step={100}
            on={(v) => setSweep({ ...sweep, periodMs: v })}
          />
          <CurveEditor
            label="Sweep curve"
            value={sweep.ease}
            onChange={(ease) => setSweep({ ...sweep, ease })}
          />
        </fieldset>
        <TransitionControls title="Image → chars" value={fIn} on={setFIn} />
        <TransitionControls title="Chars → image" value={fOut} on={setFOut} />
        <fieldset>
          <legend>In → hold → out</legend>
          <Num label="Display time (ms)" value={holdMs} min={0} max={8000} step={100} on={setHoldMs} />
        </fieldset>
      </aside>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
