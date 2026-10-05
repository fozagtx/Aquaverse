import { useEffect, useMemo, useRef, useState } from 'react';
import type { StressorKind } from '../engine/types';
import { dayLabel } from './format';

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

export interface Marker {
  tick: number;
  label: string;
  kind: StressorKind;
}

interface Props {
  title: string;
  subtitle?: string;
  ticks: number[];
  series: Series[];
  yMin?: number;
  yMax?: number;
  unit?: string;
  format?: (v: number) => string;
  markers: Marker[];
  height?: number;
}

const PAD = { top: 14, right: 92, bottom: 26, left: 38 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/**
 * Accessible line chart: one y-axis, 2px lines, direct labels at the line ends,
 * a crosshair tooltip that lists every series, stressor markers, and a table view.
 */
export function LineChart({ title, subtitle, ticks, series, yMin = 0, yMax, unit = '', format = (v) => String(Math.round(v)), markers, height = 210 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const n = ticks.length;
  const top = useMemo(() => {
    if (yMax !== undefined) return yMax;
    let m = 0;
    for (const s of series) for (const v of s.values) if (v > m) m = v;
    return niceMax(m * 1.1);
  }, [series, yMax]);

  const compact = width < 480;
  const pad = { ...PAD, right: compact ? 12 : PAD.right };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const t0 = ticks[0] ?? 0;
  const t1 = ticks[n - 1] ?? 1;
  const xOf = (t: number) => pad.left + ((t - t0) / Math.max(1, t1 - t0)) * plotW;
  const yOf = (v: number) => pad.top + plotH - ((v - yMin) / Math.max(1e-9, top - yMin)) * plotH;

  // Thin long runs so paths stay light.
  const stride = Math.max(1, Math.ceil(n / 600));
  const paths = series.map((s) => {
    let d = '';
    for (let i = 0; i < n; i += stride) d += `${d ? 'L' : 'M'}${xOf(ticks[i]).toFixed(1)},${yOf(s.values[i]).toFixed(1)}`;
    if ((n - 1) % stride) d += `L${xOf(ticks[n - 1]).toFixed(1)},${yOf(s.values[n - 1]).toFixed(1)}`;
    return d;
  });

  // Direct labels at the right end, nudged apart so they do not collide.
  const ends = series
    .map((s, i) => ({ i, y: yOf(s.values[n - 1] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
  const endY = new Map(ends.map((e) => [e.i, e.y]));

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + (top - yMin) * f);

  const onMove = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || n < 2) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const t = t0 + ((x - pad.left) / plotW) * (t1 - t0);
    let best = 0;
    for (let i = 0; i < n; i++) if (Math.abs(ticks[i] - t) < Math.abs(ticks[best] - t)) best = i;
    setHover(best);
  };

  const tableRows = useMemo(() => {
    const rows: number[] = [];
    const step = Math.max(1, Math.round(n / 40));
    for (let i = 0; i < n; i += step) rows.push(i);
    if (n && rows[rows.length - 1] !== n - 1) rows.push(n - 1);
    return rows;
  }, [n]);

  if (n < 2) {
    return (
      <figure className="chart card">
        <figcaption><h3>{title}</h3></figcaption>
        <p className="muted small">Let the stream run for a few seconds to see this chart.</p>
      </figure>
    );
  }

  const hx = hover !== null ? xOf(ticks[hover]) : 0;
  const tooltipLeft = hover !== null ? Math.min(width - 170, Math.max(0, hx + 10)) : 0;

  return (
    <figure className="chart card">
      <figcaption>
        <h3>{title}</h3>
        {subtitle && <p className="muted small">{subtitle}</p>}
        <ul className="legend" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key}>
              <svg width="18" height="8" aria-hidden="true">
                <line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinecap="round" />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      </figcaption>
      <div
        ref={wrapRef}
        className="chart-plot"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
        tabIndex={0}
        role="group"
        aria-label={`${title}. Use the left and right arrow keys to read values.`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n - 1) - Math.max(1, Math.round(n / 50))));
          else if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? 0) + Math.max(1, Math.round(n / 50))));
          else if (e.key === 'Escape') setHover(null);
        }}
        onBlur={() => setHover(null)}
      >
        <svg width={width} height={height} role="img" aria-hidden="true">
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={pad.left + plotW} y1={yOf(v)} y2={yOf(v)} className="grid" />
              <text x={pad.left - 6} y={yOf(v) + 4} className="axis-label" textAnchor="end">
                {format(v)}
              </text>
            </g>
          ))}
          <line x1={pad.left} x2={pad.left + plotW} y1={pad.top + plotH} y2={pad.top + plotH} className="baseline" />
          {[0, 0.5, 1].map((f) => {
            const t = t0 + (t1 - t0) * f;
            return (
              <text key={f} x={pad.left + plotW * f} y={height - 6} className="axis-label" textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
                {dayLabel(t)}
              </text>
            );
          })}
          {markers
            .filter((m) => m.tick >= t0 && m.tick <= t1)
            .map((m, i) => (
              <g key={`${m.tick}-${i}`}>
                <line x1={xOf(m.tick)} x2={xOf(m.tick)} y1={pad.top} y2={pad.top + plotH} className="marker-line" />
                {!compact && (
                  <text x={xOf(m.tick) + 3} y={pad.top + 9 + (i % 3) * 11} className="marker-label">
                    {m.label}
                  </text>
                )}
              </g>
            ))}
          {series.map((s, i) => (
            <path
              key={s.key}
              d={paths[i]}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
          ))}
          {!compact &&
            series.map((s, i) => (
              <text key={s.key} x={pad.left + plotW + 6} y={(endY.get(i) ?? 0) + 4} className="end-label">
                {s.label} {format(s.values[n - 1])}
                {unit}
              </text>
            ))}
          {hover !== null && (
            <g>
              <line x1={hx} x2={hx} y1={pad.top} y2={pad.top + plotH} className="crosshair" />
              {series.map((s) => (
                <circle key={s.key} cx={hx} cy={yOf(s.values[hover])} r={4} fill={s.color} className="hover-dot" />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: tooltipLeft }} role="status">
            <div className="tooltip-title">{dayLabel(ticks[hover])}</div>
            {series.map((s) => (
              <div key={s.key} className="tooltip-row">
                <svg width="12" height="6" aria-hidden="true">
                  <line x1="0" y1="3" x2="12" y2="3" stroke={s.color} strokeWidth="2" />
                </svg>
                <strong>
                  {format(s.values[hover])}
                  {unit}
                </strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="linklike small" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
        {showTable ? 'Hide table' : 'Show as a table'}
      </button>
      {showTable && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {series.map((s) => (
                  <th key={s.key} scope="col">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((i) => (
                <tr key={i}>
                  <th scope="row">{dayLabel(ticks[i])}</th>
                  {series.map((s) => (
                    <td key={s.key}>
                      {format(s.values[i])}
                      {unit}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
