import type { ReactElement } from 'react';
import type { StressorKind } from '../engine/types';

/**
 * Small pixel icons as inline SVG (crisp at any size, no image files).
 * Each is a grid of rects on a 12 by 12 canvas.
 */

type Px = [number, number, number?, number?, string?];

function PixelIcon({ px, color = 'currentColor', size = 24, title }: { px: Px[]; color?: string; size?: number; title?: string }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {px.map(([x, y, w = 1, h = 1, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c ?? color} />
      ))}
    </svg>
  );
}

const SUN: Px[] = [
  [4, 4, 4, 4, '#f59e0b'], [5, 3, 2, 1, '#f59e0b'], [5, 8, 2, 1, '#f59e0b'], [3, 5, 1, 2, '#f59e0b'], [8, 5, 1, 2, '#f59e0b'],
  [5, 0, 2, 2, '#f97316'], [5, 10, 2, 2, '#f97316'], [0, 5, 2, 2, '#f97316'], [10, 5, 2, 2, '#f97316'],
  [1, 1, 2, 2, '#f97316'], [9, 1, 2, 2, '#f97316'], [1, 9, 2, 2, '#f97316'], [9, 9, 2, 2, '#f97316'],
  [5, 5, 1, 1, '#fde68a'],
];
const DROP: Px[] = [
  [5, 1, 2, 1, '#b45309'], [4, 2, 4, 2, '#b45309'], [3, 4, 6, 3, '#b45309'], [3, 7, 6, 2, '#92400e'], [4, 9, 4, 1, '#92400e'],
  [4, 4, 1, 2, '#fbbf24'], [0, 11, 12, 1, '#a16207'], [2, 10, 1, 1, '#a16207'], [9, 10, 1, 1, '#a16207'],
];
const CLOUD: Px[] = [
  [3, 1, 4, 1, '#64748b'], [2, 2, 7, 1, '#64748b'], [1, 3, 10, 3, '#64748b'], [2, 6, 8, 1, '#475569'],
  [3, 2, 2, 1, '#94a3b8'],
  [2, 8, 1, 2, '#3b82f6'], [5, 8, 1, 2, '#3b82f6'], [8, 8, 1, 2, '#3b82f6'], [3, 10, 1, 2, '#3b82f6'], [6, 10, 1, 2, '#3b82f6'], [9, 10, 1, 2, '#3b82f6'],
];
const PIPE: Px[] = [
  [0, 2, 7, 4, '#6b7280'], [0, 2, 7, 1, '#9ca3af'], [6, 1, 2, 6, '#4b5563'], [7, 3, 1, 2, '#111827'],
  [8, 4, 1, 2, '#7c5c2e'], [9, 5, 1, 3, '#7c5c2e'], [8, 8, 3, 2, '#6b4f2a'], [7, 10, 5, 2, '#5b4321'],
];
const AXE: Px[] = [
  [2, 9, 3, 3, '#7c4a1e'], [3, 7, 2, 2, '#7c4a1e'], [5, 5, 2, 2, '#7c4a1e'], [7, 3, 2, 2, '#7c4a1e'],
  [6, 0, 4, 2, '#9ca3af'], [8, 1, 4, 3, '#9ca3af'], [9, 4, 2, 1, '#6b7280'], [8, 0, 2, 1, '#d1d5db'],
];
const SPROUT: Px[] = [
  [5, 5, 2, 6, '#65a30d'], [1, 2, 4, 2, '#22c55e'], [2, 4, 3, 1, '#16a34a'], [7, 1, 4, 2, '#22c55e'], [7, 3, 3, 1, '#16a34a'],
  [2, 10, 8, 2, '#7c5c2e'],
];

export const STRESSOR_ICON: Record<StressorKind, Px[]> = {
  heatwave: SUN,
  drought: DROP,
  storm: CLOUD,
  sewage: PIPE,
  clearTrees: AXE,
  plantTrees: SPROUT,
};

export function StressorIcon({ kind, size = 28 }: { kind: StressorKind; size?: number }): ReactElement {
  return <PixelIcon px={STRESSOR_ICON[kind]} size={size} />;
}

export function Logo({ size = 28 }: { size?: number }): ReactElement {
  return (
    <PixelIcon
      size={size}
      px={[
        [0, 7, 12, 5, '#3a8fc6'], [0, 7, 3, 1, '#cfeafa'], [5, 8, 3, 1, '#cfeafa'], [9, 10, 2, 1, '#cfeafa'],
        [3, 2, 6, 1, '#2d6a2c'], [2, 3, 8, 3, '#3f8a3a'], [3, 3, 2, 1, '#62b052'], [5, 6, 2, 1, '#6b4a2a'],
        [7, 9, 3, 1, '#e9b04b'], [6, 9, 1, 1, '#f7e1a1'],
      ]}
    />
  );
}

export function PlayIcon(): ReactElement {
  return <PixelIcon size={16} px={[[3, 2, 2, 8], [5, 3, 2, 6], [7, 4, 2, 4], [9, 5, 1, 2]]} />;
}

export function PauseIcon(): ReactElement {
  return <PixelIcon size={16} px={[[3, 2, 2, 8], [7, 2, 2, 8]]} />;
}

/** Picture answers for the stream check. */
export function AnswerPicture({ name }: { name: string }): ReactElement {
  const pics: Record<string, Px[]> = {
    clear: [[0, 3, 12, 9, '#7cc4f0'], [0, 3, 12, 1, '#cfeafa'], [2, 9, 3, 2, '#9ca3af'], [7, 10, 3, 1, '#9ca3af'], [6, 8, 2, 2, '#8f877b']],
    cloudy: [[0, 3, 12, 9, '#94b8c8'], [0, 3, 12, 1, '#d6e4ea'], [2, 6, 2, 1, '#c3d3da'], [7, 8, 3, 1, '#c3d3da'], [3, 10, 3, 1, '#a9b9bf']],
    murky: [[0, 3, 12, 9, '#5f7d3a'], [0, 3, 12, 1, '#8aa65a'], [2, 5, 3, 2, '#4a6a2a'], [7, 7, 3, 2, '#4a6a2a'], [4, 9, 2, 1, '#3d5722']],
    none: [[3, 3, 6, 6, '#e5e7eb'], [4, 4, 4, 4, '#ffffff'], [5, 6, 2, 1, '#9ca3af']],
    earthy: [[0, 8, 12, 4, '#7c5c2e'], [2, 6, 2, 2, '#65a30d'], [7, 5, 2, 3, '#65a30d'], [4, 2, 1, 2, '#a16207'], [6, 1, 1, 2, '#a16207'], [8, 2, 1, 2, '#a16207']],
    sewage: [[0, 8, 12, 4, '#6a5d4b'], [3, 1, 1, 3, '#84cc16'], [5, 2, 1, 4, '#84cc16'], [7, 1, 1, 3, '#84cc16'], [2, 6, 2, 2, '#4d4337'], [8, 6, 2, 2, '#4d4337']],
    trees: [[0, 9, 12, 3, '#3a8fc6'], [0, 2, 4, 5, '#3f8a3a'], [8, 2, 4, 5, '#3f8a3a'], [1, 7, 1, 2, '#6b4a2a'], [10, 7, 1, 2, '#6b4a2a'], [1, 1, 2, 1, '#62b052'], [9, 1, 2, 1, '#62b052']],
    bushes: [[0, 9, 12, 3, '#3a8fc6'], [0, 6, 3, 3, '#4f9a3a'], [9, 7, 3, 2, '#4f9a3a'], [0, 8, 12, 1, '#7fb04f']],
    grass: [[0, 9, 12, 3, '#3a8fc6'], [0, 6, 12, 3, '#9cc865'], [2, 5, 1, 1, '#7fb04f'], [6, 5, 1, 1, '#7fb04f'], [10, 5, 1, 1, '#7fb04f']],
    concrete: [[0, 9, 12, 3, '#5a7f99'], [0, 3, 2, 6, '#9ca3af'], [10, 3, 2, 6, '#9ca3af'], [0, 3, 12, 1, '#d1d5db'], [2, 8, 8, 1, '#6b7280']],
    many: [[0, 4, 12, 8, '#7cc4f0'], [1, 6, 4, 1, '#e9b04b'], [7, 5, 4, 2, '#d6eefa'], [6, 6, 1, 1, '#3f7fae'], [3, 9, 3, 1, '#e5484d'], [8, 9, 1, 2, '#a78bfa']],
    few: [[0, 4, 12, 8, '#94b8c8'], [3, 7, 4, 1, '#e5484d'], [8, 9, 1, 2, '#a78bfa']],
    worms: [[0, 4, 12, 8, '#7d6646'], [2, 7, 1, 1, '#e5484d'], [3, 8, 2, 1, '#e5484d'], [5, 7, 1, 1, '#e5484d'], [7, 9, 3, 1, '#e5484d']],
    fast: [[0, 2, 12, 10, '#3a8fc6'], [1, 4, 4, 1, '#cfeafa'], [6, 4, 5, 1, '#cfeafa'], [2, 7, 5, 1, '#cfeafa'], [8, 7, 3, 1, '#cfeafa'], [1, 10, 4, 1, '#cfeafa'], [7, 10, 4, 1, '#cfeafa']],
    slow: [[0, 2, 12, 10, '#3a8fc6'], [2, 5, 3, 1, '#cfeafa'], [7, 9, 3, 1, '#cfeafa']],
    still: [[0, 2, 12, 10, '#4a7f8f'], [3, 6, 6, 1, '#6c9aa8'], [2, 7, 1, 1, '#6c9aa8'], [9, 7, 1, 1, '#6c9aa8'], [5, 4, 1, 1, '#a78bfa']],
    unsure: [[4, 2, 4, 1, '#6b7280'], [3, 3, 1, 2, '#6b7280'], [8, 3, 1, 2, '#6b7280'], [7, 5, 1, 1, '#6b7280'], [5, 6, 2, 2, '#6b7280'], [5, 9, 2, 2, '#6b7280']],
  };
  return <PixelIcon px={pics[name] ?? pics.unsure} size={44} />;
}
