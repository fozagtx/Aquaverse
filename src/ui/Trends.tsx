import { useMemo } from 'react';
import { SPECIES, STRESSORS } from '../engine/constants';
import type { HistoryPoint, LogEntry } from '../engine/types';
import { LineChart, type Marker, type Series } from './LineChart';
import { SPECIES_COLORS, SPECIES_ORDER } from './sprites';

/** Validated categorical slots (blue, orange, aqua, yellow) for non-species charts. */
const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500'];

export function Trends({ history, log }: { history: HistoryPoint[]; log: LogEntry[] }) {
  const ticks = useMemo(() => history.map((h) => h.tick), [history]);
  const markers: Marker[] = useMemo(
    () => log.filter((l) => l.kind === 'stressor' && l.stressor).map((l) => ({ tick: l.tick, kind: l.stressor!, label: STRESSORS[l.stressor!].label })),
    [log],
  );

  const populations: Series[] = useMemo(
    () => [
      ...SPECIES_ORDER.map((s) => ({ key: s, label: SPECIES[s].plural, color: SPECIES_COLORS[s], values: history.map((h) => h.counts[s]) })),
    ],
    [history],
  );

  const temperature: Series[] = useMemo(
    () => [
      { key: 'water', label: 'Water', color: SLOTS[0], values: history.map((h) => h.waterTemp) },
      { key: 'air', label: 'Air', color: SLOTS[1], values: history.map((h) => h.airTemp), dashed: true },
    ],
    [history],
  );

  const quality: Series[] = useMemo(
    () => [
      { key: 'oxygen', label: 'Oxygen', color: SLOTS[0], values: history.map((h) => h.oxygen) },
      { key: 'nutrients', label: 'Nutrients', color: SLOTS[1], values: history.map((h) => h.nutrients) },
      { key: 'germs', label: 'Germs', color: SLOTS[2], values: history.map((h) => h.pathogens) },
      { key: 'flow', label: 'Flow', color: SLOTS[3], values: history.map((h) => h.flow) },
    ],
    [history],
  );

  const cover: Series[] = useMemo(
    () => [
      { key: 'shade', label: 'Shade', color: SLOTS[0], values: history.map((h) => h.shade * 100) },
      { key: 'algae', label: 'Algae', color: SLOTS[2], values: history.map((h) => h.algae * 100) },
    ],
    [history],
  );

  const gauges: Series[] = useMemo(
    () => [
      { key: 'eco', label: 'Ecosystem', color: SLOTS[0], values: history.map((h) => h.ecosystem) },
      { key: 'bio', label: 'Biodiversity', color: SLOTS[1], values: history.map((h) => h.biodiversity) },
      { key: 'risk', label: 'Health risk', color: SLOTS[2], values: history.map((h) => h.risk) },
    ],
    [history],
  );

  const tolerance: Series[] = useMemo(
    () => SPECIES_ORDER.map((s) => ({ key: s, label: SPECIES[s].plural, color: SPECIES_COLORS[s], values: history.map((h) => h.tolerance[s] * 100) })),
    [history],
  );

  return (
    <div className="trends">
      <header className="page-head">
        <h1>Trends</h1>
        <p className="lede">How the stream has changed since it appeared. Vertical lines mark each stressor. Hover, or focus a chart and use the arrow keys, to read values.</p>
      </header>
      <div className="chart-grid">
        <LineChart title="Who lives here" subtitle="Number of each species in the stream" ticks={ticks} series={populations} markers={markers} />
        <LineChart title="One Health gauges" subtitle="0 to 100. Higher risk is worse; higher health and biodiversity are better." ticks={ticks} series={gauges} markers={markers} yMax={100} />
        <LineChart title="Temperature" subtitle="Water follows the air, cooled by shade and flow" ticks={ticks} series={temperature} markers={markers} yMin={10} yMax={40} unit=" °C" format={(v) => v.toFixed(1)} />
        <LineChart title="Water quality" subtitle="Each on a 0 to 100 scale" ticks={ticks} series={quality} markers={markers} yMax={100} />
        <LineChart title="Shade and algae" subtitle="Percent of the bank shaded by trees, and algae cover on the stream bed" ticks={ticks} series={cover} markers={markers} yMax={100} unit="%" />
        <LineChart
          title="Inherited pollution tolerance"
          subtitle="Average across each population. Under long stress, more tolerant individuals survive and pass it on."
          ticks={ticks}
          series={tolerance}
          markers={markers}
          yMax={100}
          unit="%"
        />
      </div>
    </div>
  );
}
