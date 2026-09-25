import { useEffect, useRef, useState } from 'react';

export interface Series {
  name: string;
  /** Rol de color: variable CSS de la paleta categórica (--series-1 … --series-4). */
  color: string;
  values: (number | null)[];
}

interface Props {
  labels: string[];
  series: Series[];
  unit?: string;
  yMax?: number;
  height?: number;
  ariaLabel: string;
}

const PAD = { top: 16, right: 96, bottom: 28, left: 40 };

/**
 * Gráfico de líneas en SVG: líneas de 2px, marcadores de 8px, grilla tenue, un solo eje Y,
 * leyenda (≥2 series) + etiqueta directa al final de cada línea, y tooltip con cruz al pasar el mouse.
 */
export function LineChart({ labels, series, unit = '', yMax, height = 240, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const max = yMax ?? Math.max(1, Math.ceil((Math.max(...all, 0) * 1.15) / 5) * 5);
  const w = width - PAD.left - PAD.right;
  const h = height - PAD.top - PAD.bottom;
  const n = labels.length;
  const x = (i: number) => PAD.left + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => PAD.top + h - (v / max) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * max));

  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };

  // Etiquetas directas al final, separadas para que no se superpongan
  const ends = series
    .map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && s.values[i] === null) i--;
      return i >= 0 ? { s, i, v: s.values[i] as number, ty: y(s.values[i] as number) } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.ty - b.ty);
  for (let k = 1; k < ends.length; k++) if (ends[k].ty - ends[k - 1].ty < 14) ends[k].ty = ends[k - 1].ty + 14;

  return (
    <div className="linechart" ref={ref}>
      {series.length > 1 && (
        <div className="legend-row" aria-hidden>
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: `var(${s.color})` }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + w} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 6} y={y(t) + 4} className="axis" textAnchor="end">
              {t}
              {unit}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          n <= 6 || i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0 ? (
            <text key={i} x={x(i)} y={height - 8} className="axis" textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + h} className="crosshair" />}
        {series.map((s) => (
          <g key={s.name}>
            <path d={path(s.values)} fill="none" stroke={`var(${s.color})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) =>
              v === null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4} fill={`var(${s.color})`} stroke="var(--surface)" strokeWidth={2} />
              ),
            )}
          </g>
        ))}
        {ends.map((e) => (
          <text key={e.s.name} x={x(e.i) + 10} y={e.ty + 4} className="direct-label">
            {series.length > 1 ? `${e.s.name} ` : ''}
            {e.v}
            {unit}
          </text>
        ))}
        <rect x={PAD.left} y={PAD.top} width={w} height={h} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(x(hover) + 12, width - 190), top: PAD.top }}>
          <b>{labels[hover]}</b>
          {series.map((s) => (
            <div key={s.name}>
              <i style={{ background: `var(${s.color})` }} />
              {s.name}: <b>{s.values[hover] ?? 'n/e'}{s.values[hover] !== null ? unit : ''}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
