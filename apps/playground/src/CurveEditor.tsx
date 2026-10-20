import { useRef } from 'react';
import { EASES, type Bezier, type Ease } from '@ui-components/ascii-image';

const W = 220;
const H = 220;
const PAD = 14;
const Y_MIN = -0.5;
const Y_MAX = 1.5;

const px = (x: number) => PAD + x * (W - 2 * PAD);
const py = (y: number) => PAD + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * (H - 2 * PAD);
const round = (v: number) => Math.round(v * 100) / 100;

/** An ease as a graph: drag the two control points, or type them; presets and steps from the list. */
export function CurveEditor({
  value,
  onChange,
  label,
}: {
  value: Ease;
  onChange: (e: Ease) => void;
  label: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const steps = typeof value === 'object' && 'steps' in value ? value.steps : null;
  const pts: Bezier = steps ? [0, 0, 1, 1] : typeof value === 'string' ? EASES[value] : (value as Bezier);
  const preset =
    steps !== null
      ? 'steps'
      : typeof value === 'string'
        ? value
        : (Object.entries(EASES).find(([, b]) => b.every((v, i) => v === pts[i]))?.[0] ?? 'custom');

  const drag = (handle: 0 | 1) => (e: React.PointerEvent) => {
    const el = svg.current;
    if (!el || steps !== null) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, ((ev.clientX - r.left) * (W / r.width) - PAD) / (W - 2 * PAD)));
      const y = Y_MAX - (((ev.clientY - r.top) * (H / r.height) - PAD) / (H - 2 * PAD)) * (Y_MAX - Y_MIN);
      const next = [...pts] as [number, number, number, number];
      next[handle * 2] = round(x);
      next[handle * 2 + 1] = round(Math.min(Y_MAX, Math.max(Y_MIN, y)));
      onChange(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const curve = steps
    ? Array.from(
        { length: steps },
        (_, i) => `${i ? 'L' : 'M'}${px(i / steps)},${py(i / steps)} H${px((i + 1) / steps)}`,
      ).join(' ') + ` V${py(1)}`
    : `M${px(0)},${py(0)} C${px(pts[0])},${py(pts[1])} ${px(pts[2])},${py(pts[3])} ${px(1)},${py(1)}`;

  return (
    <div className="curve">
      <label>
        <span>{label}</span>
        <select
          value={preset}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'steps') onChange({ steps: 6 });
            else if (v !== 'custom') onChange(v as keyof typeof EASES);
          }}
        >
          {Object.keys(EASES).map((k) => (
            <option key={k}>{k}</option>
          ))}
          <option value="steps">steps(n)</option>
          <option value="custom" disabled>
            custom
          </option>
        </select>
      </label>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="curve__graph" aria-hidden="true">
        <rect x={px(0)} y={py(1)} width={px(1) - px(0)} height={py(0) - py(1)} className="curve__box" />
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="curve__diag" />
        {steps === null && (
          <>
            <line x1={px(0)} y1={py(0)} x2={px(pts[0])} y2={py(pts[1])} className="curve__arm" />
            <line x1={px(1)} y1={py(1)} x2={px(pts[2])} y2={py(pts[3])} className="curve__arm" />
          </>
        )}
        <path d={curve} className="curve__path" />
        {steps === null &&
          ([0, 1] as const).map((h) => (
            <circle
              key={h}
              cx={px(pts[h * 2]!)}
              cy={py(pts[h * 2 + 1]!)}
              r={8}
              className="curve__handle"
              onPointerDown={drag(h)}
            />
          ))}
      </svg>
      {steps !== null ? (
        <label>
          <span>Steps</span>
          <input
            type="number"
            min={1}
            max={32}
            value={steps}
            onChange={(e) => onChange({ steps: Number(e.target.value) || 1 })}
          />
        </label>
      ) : (
        <div className="curve__nums">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((n, i) => (
            <label key={n}>
              <span>{n}</span>
              <input
                type="number"
                step={0.05}
                min={i % 2 ? Y_MIN : 0}
                max={i % 2 ? Y_MAX : 1}
                value={pts[i]}
                onChange={(e) => {
                  const next = [...pts] as [number, number, number, number];
                  next[i] = Number(e.target.value);
                  onChange(next);
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
