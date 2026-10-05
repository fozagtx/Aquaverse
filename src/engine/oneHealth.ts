import type { Band, Gauge, GaugeFactor, Gauges, SpeciesId, StreamState } from './types';

/**
 * The One Health readout: three illustrative gauges from 0 to 100, computed
 * only from the simulated stream so they replay and rewind with it.
 * The weights are teaching assumptions, not a validated index.
 */

export function bandOf(value: number): Band {
  return value < 34 ? 'low' : value < 67 ? 'moderate' : 'high';
}

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface GaugeInputs {
  stream: StreamState;
  counts: Record<SpeciesId, number>;
}

/** Weights used by each gauge; shown in the field guide. */
export const GAUGE_WEIGHTS = {
  ecosystem: { oxygen: 0.35, nutrients: 0.2, shade: 0.15, flow: 0.15, algae: 0.15 },
  biodiversity: { taxa: 0.35, evenness: 0.25, sensitive: 0.4 },
  risk: { bloom: 0.2, pathogens: 0.35, mosquitoes: 0.35, heat: 0.1 },
};

export function flowScore(flow: number): number {
  if (flow < 30) return c01(flow / 30);
  if (flow > 75) return c01(1 - (flow - 75) / 40);
  return 1;
}

function healthGauge(id: 'ecosystem' | 'biodiversity', label: string, parts: Array<{ key: string; score: number; weight: number; good: string; bad: string }>): Gauge {
  let value = 0;
  for (const p of parts) value += p.score * p.weight;
  value = Math.round(100 * value);
  const band = bandOf(value);
  const factors: GaugeFactor[] = parts.map((p) => ({
    key: p.key,
    phrase: p.score >= 0.7 ? p.good : p.bad,
    // Drag on the gauge (what is pulling it down).
    weight: (1 - p.score) * p.weight,
  }));
  let top: GaugeFactor;
  if (band === 'high') {
    // Explain a high gauge by what helps it most.
    const best = parts.reduce((a, b) => (b.score * b.weight > a.score * a.weight ? b : a));
    top = { key: best.key, phrase: best.good, weight: best.score * best.weight };
  } else {
    top = factors.reduce((a, b) => (b.weight > a.weight ? b : a));
  }
  return { id, label, value, band, top, factors };
}

export function computeGauges({ stream: s, counts }: GaugeInputs): Gauges {
  const w = GAUGE_WEIGHTS;

  const ecosystem = healthGauge('ecosystem', 'Ecosystem health', [
    { key: 'oxygen', score: c01((s.oxygen - 20) / 70), weight: w.ecosystem.oxygen, good: 'plenty of oxygen', bad: 'low oxygen' },
    { key: 'nutrients', score: c01(1 - (s.nutrients - 10) / 70), weight: w.ecosystem.nutrients, good: 'few excess nutrients', bad: 'too many nutrients' },
    { key: 'shade', score: c01(s.shade / 0.7), weight: w.ecosystem.shade, good: 'shade from bank trees', bad: 'little shade' },
    { key: 'flow', score: flowScore(s.flow), weight: w.ecosystem.flow, good: 'a healthy flow', bad: s.flow < 30 ? 'too little flow' : 'a flood surge' },
    { key: 'algae', score: c01(1 - (s.meanAlgae - 0.4) / 0.45), weight: w.ecosystem.algae, good: 'algae in balance', bad: 'too much algae' },
  ]);

  const total = counts.mayfly + counts.midge + counts.mosquito + counts.fish;
  const present = (Object.keys(counts) as SpeciesId[]).filter((k) => counts[k] > 0);
  let evenness = 0;
  if (present.length > 1 && total > 0) {
    let h = 0;
    for (const k of present) {
      const p = counts[k] / total;
      h -= p * Math.log(p);
    }
    evenness = h / Math.log(4);
  }
  const inverts = counts.mayfly + counts.midge + counts.mosquito;
  const sensitiveShare = inverts ? counts.mayfly / inverts : 0;
  const biodiversity = healthGauge('biodiversity', 'Biodiversity', [
    { key: 'taxa', score: present.length / 4, weight: w.biodiversity.taxa, good: 'all four kinds of life present', bad: present.length <= 2 ? 'few kinds of life left' : 'a kind of life missing' },
    { key: 'evenness', score: c01(evenness), weight: w.biodiversity.evenness, good: 'a good mix of species', bad: 'one species dominating' },
    { key: 'sensitive', score: c01(sensitiveShare / 0.5), weight: w.biodiversity.sensitive, good: 'sensitive mayflies present', bad: counts.mayfly === 0 ? 'no sensitive mayflies' : 'few sensitive mayflies' },
  ]);

  const parts = [
    { key: 'bloom', score: c01((s.meanAlgae - 0.45) / 0.4), weight: w.risk.bloom, phrase: 'algal bloom toxins' },
    { key: 'pathogens', score: c01((s.pathogens - 10) / 55), weight: w.risk.pathogens, phrase: 'germs in the water' },
    { key: 'mosquitoes', score: c01((counts.mosquito + 2 * s.adultMosquitoes) / 40), weight: w.risk.mosquitoes, phrase: 'mosquitoes' },
    { key: 'heat', score: c01((1 - s.shade) * 0.6 + Math.max(0, s.airTemp - 26) / 10 * 0.6), weight: w.risk.heat, phrase: s.airTemp > 28 ? 'the heat' : 'little shade on the banks' },
  ];
  let riskValue = 0;
  for (const p of parts) riskValue += p.score * p.weight;
  riskValue = Math.round(100 * riskValue);
  const riskFactors: GaugeFactor[] = parts.map((p) => ({ key: p.key, phrase: p.phrase, weight: p.score * p.weight }));
  const riskTop = riskFactors.reduce((a, b) => (b.weight > a.weight ? b : a));
  const risk: Gauge = {
    id: 'risk',
    label: 'Human health risk',
    value: riskValue,
    band: bandOf(riskValue),
    top: riskValue < 8 ? { key: 'none', phrase: 'nothing in particular', weight: 0 } : riskTop,
    factors: riskFactors,
  };

  return { ecosystem, biodiversity, risk };
}

/** "Human health risk: high, mainly mosquitoes" */
export function gaugeSentence(g: Gauge): string {
  return `${g.label}: ${g.band}, mainly ${g.top.phrase}`;
}
