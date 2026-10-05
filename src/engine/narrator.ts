import { SPECIES, STRESSORS } from './constants';
import { bandOf } from './oneHealth';
import type {
  CauseFacts,
  GaugeChange,
  GaugeId,
  Gauges,
  SpeciesChange,
  SpeciesId,
  StreamState,
  StressorKind,
  VariableChange,
  VariableKey,
} from './types';
import { SPECIES_IDS } from './types';

/**
 * Rule-based narrator. It only ever describes facts the simulation produced:
 * the stressor, the water variables that moved, the species that changed and
 * the gauges that moved. Free, instant and deterministic.
 */

/** A moment in the run that explanations compare against. */
export interface Sample {
  tick: number;
  stream: Pick<StreamState, 'waterTemp' | 'airTemp' | 'oxygen' | 'nutrients' | 'pathogens' | 'flow' | 'shade' | 'meanAlgae' | 'bloom'>;
  counts: Record<SpeciesId, number>;
  /** Counts in the stretch just downstream of the storm drain. */
  nearDrain: Record<SpeciesId, number>;
  /** Running total of creatures washed away. */
  washedOut: number;
  stress: Record<SpeciesId, number>;
  gauges: Record<GaugeId, { value: number; topPhrase: string; topKey: string }>;
}

export function takeSample(
  tick: number,
  s: StreamState,
  counts: Record<SpeciesId, number>,
  nearDrain: Record<SpeciesId, number>,
  washedOut: number,
  stress: Record<SpeciesId, number>,
  gauges: Gauges,
): Sample {
  return {
    nearDrain: { ...nearDrain },
    washedOut,
    tick,
    stream: {
      waterTemp: s.waterTemp,
      airTemp: s.airTemp,
      oxygen: s.oxygen,
      nutrients: s.nutrients,
      pathogens: s.pathogens,
      flow: s.flow,
      shade: s.shade,
      meanAlgae: s.meanAlgae,
      bloom: s.bloom,
    },
    counts: { ...counts },
    stress: { ...stress },
    gauges: {
      ecosystem: { value: gauges.ecosystem.value, topPhrase: gauges.ecosystem.top.phrase, topKey: gauges.ecosystem.top.key },
      biodiversity: { value: gauges.biodiversity.value, topPhrase: gauges.biodiversity.top.phrase, topKey: gauges.biodiversity.top.key },
      risk: { value: gauges.risk.value, topPhrase: gauges.risk.top.phrase, topKey: gauges.risk.top.key },
    },
  };
}

const PRIORITY: Record<StressorKind, VariableKey[]> = {
  heatwave: ['waterTemp', 'oxygen', 'algae', 'flow', 'nutrients', 'pathogens', 'shade'],
  drought: ['flow', 'waterTemp', 'oxygen', 'algae', 'nutrients', 'pathogens', 'shade'],
  storm: ['flow', 'nutrients', 'algae', 'oxygen', 'pathogens', 'waterTemp', 'shade'],
  sewage: ['pathogens', 'oxygen', 'nutrients', 'algae', 'waterTemp', 'flow', 'shade'],
  clearTrees: ['shade', 'waterTemp', 'oxygen', 'algae', 'nutrients', 'pathogens', 'flow'],
  plantTrees: ['shade', 'waterTemp', 'oxygen', 'algae', 'nutrients', 'pathogens', 'flow'],
};
const DEFAULT_PRIORITY: VariableKey[] = ['oxygen', 'waterTemp', 'algae', 'pathogens', 'nutrients', 'flow', 'shade'];

/** Later in a chain, the slower consequences matter more. */
const LATE_PRIORITY: Record<StressorKind, VariableKey[]> = {
  heatwave: ['waterTemp', 'oxygen', 'algae', 'flow', 'nutrients', 'pathogens', 'shade'],
  drought: ['flow', 'waterTemp', 'oxygen', 'algae', 'nutrients', 'pathogens', 'shade'],
  storm: ['algae', 'oxygen', 'nutrients', 'pathogens', 'waterTemp', 'flow', 'shade'],
  sewage: ['oxygen', 'pathogens', 'nutrients', 'algae', 'waterTemp', 'flow', 'shade'],
  clearTrees: ['waterTemp', 'algae', 'oxygen', 'shade', 'nutrients', 'pathogens', 'flow'],
  plantTrees: ['shade', 'waterTemp', 'oxygen', 'algae', 'nutrients', 'pathogens', 'flow'],
};

/** When the second explanation counts as "later in the chain". */
const LATE_SECONDS = 35;

/** Smallest change worth mentioning for each variable. */
const THRESHOLD: Record<VariableKey, number> = {
  waterTemp: 0.8,
  airTemp: 1.5,
  oxygen: 4,
  nutrients: 5,
  pathogens: 5,
  flow: 8,
  shade: 0.05,
  algae: 0.05,
};

function value(sample: Sample, key: VariableKey): number {
  return key === 'algae' ? sample.stream.meanAlgae : sample.stream[key];
}

function variableChanges(before: Sample, after: Sample, stressor: StressorKind | null, late: boolean): VariableChange[] {
  const order = stressor ? (late ? LATE_PRIORITY : PRIORITY)[stressor] : DEFAULT_PRIORITY;
  const out: VariableChange[] = [];
  for (const key of order) {
    const from = value(before, key);
    const to = value(after, key);
    if (Math.abs(to - from) >= THRESHOLD[key]) out.push({ key, from: round(from, key), to: round(to, key) });
  }
  return out;
}

function round(v: number, key: VariableKey): number {
  return key === 'shade' || key === 'algae' ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
}

function speciesChanges(before: Record<SpeciesId, number>, after: Record<SpeciesId, number>, minDelta = 5): SpeciesChange[] {
  const out: SpeciesChange[] = [];
  for (const species of SPECIES_IDS) {
    const from = before[species];
    const to = after[species];
    if (from === to) continue;
    const gone = from >= 3 && to === 0;
    const arrived = from === 0 && to >= 3;
    const big = Math.abs(to - from) >= minDelta && Math.abs(to - from) / Math.max(1, from) >= 0.25;
    if (gone || arrived || big) out.push({ species, from, to });
  }
  // Sensitive losses and risky gains first.
  const rank = (c: SpeciesChange) => {
    const sensitive = SPECIES[c.species].indicator === 'sensitive' ? 2 : 0;
    const risky = c.species === 'mosquito' ? 1.5 : 0;
    return (c.to === 0 ? 3 : 0) + (c.to < c.from ? sensitive : risky) + Math.abs(c.to - c.from) / Math.max(1, c.from);
  };
  return out.sort((a, b) => rank(b) - rank(a));
}

function gaugeChanges(before: Sample, after: Sample): GaugeChange[] {
  const ids: GaugeId[] = ['ecosystem', 'biodiversity', 'risk'];
  return ids.map((gauge) => ({
    gauge,
    from: before.gauges[gauge].value,
    to: after.gauges[gauge].value,
    fromBand: bandOf(before.gauges[gauge].value),
    toBand: bandOf(after.gauges[gauge].value),
    topPhrase: after.gauges[gauge].topPhrase,
  }));
}

export function buildFacts(
  trigger: CauseFacts['trigger'],
  stressor: StressorKind | null,
  before: Sample,
  after: Sample,
  tickRate: number,
  bandGauge?: GaugeId,
  others: { during: StressorKind[]; later: StressorKind[] } = { during: [], later: [] },
): CauseFacts {
  const risk = after.gauges.risk;
  const secondsSince = Math.round((after.tick - before.tick) / tickRate);
  return {
    trigger,
    stressor,
    ...(others.during.length ? { during: others.during } : {}),
    ...(others.later.length ? { later: others.later } : {}),
    secondsSince,
    variables: variableChanges(before, after, stressor, secondsSince >= LATE_SECONDS),
    species: speciesChanges(before.counts, after.counts),
    nearDrain:
      stressor === 'sewage' || stressor === 'storm'
        ? speciesChanges(before.nearDrain, after.nearDrain, 2).filter((c) => c.to < c.from && (c.species === 'mayfly' || c.species === 'midge'))
        : [],
    washedOut: Math.max(0, after.washedOut - before.washedOut),
    stressed: SPECIES_IDS.filter((s) => after.counts[s] > 0 && after.stress[s] > 0.12 && after.stress[s] - before.stress[s] > 0.08),
    gauges: gaugeChanges(before, after),
    risk: { value: risk.value, band: bandOf(risk.value), topKey: risk.topKey, topPhrase: risk.topPhrase },
    bandGauge,
  };
}

const CAUSE: Record<StressorKind, string> = {
  heatwave: 'The heatwave heated the air',
  drought: 'The drought cut the flow',
  storm: 'Storm runoff washed off the pavement',
  sewage: 'Sewage leaked from the storm drain',
  clearTrees: 'The bank trees were cleared',
  plantTrees: 'New bank trees were planted',
};

/** The same causes mid-sentence, for other stressors that overlapped the one being explained. */
const THEN: Record<StressorKind, string> = {
  heatwave: 'a heatwave heated the air',
  drought: 'a drought cut the flow',
  storm: 'storm runoff washed off the pavement',
  sewage: 'sewage leaked from the storm drain',
  clearTrees: 'the bank trees were cleared',
  plantTrees: 'new bank trees were planted',
};

const WATCH: Record<StressorKind, string> = {
  heatwave: 'Watch the water temperature, the oxygen and the mayflies.',
  drought: 'Watch the flow and the mosquito larvae in the still edges.',
  storm: 'Watch the flow first, then the algae and the oxygen.',
  sewage: 'Watch the water downstream of the drain.',
  clearTrees: 'Watch the shade, the water temperature and the algae.',
  plantTrees: 'Watch the shade come back as the saplings grow.',
};

function fmt(n: number): string {
  const r = Math.round(Math.abs(n) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function variablePhrase(c: VariableChange): string {
  const d = c.to - c.from;
  switch (c.key) {
    case 'waterTemp':
      return d > 0 ? `the water warmed by ${fmt(d)} °C` : `the water cooled by ${fmt(d)} °C`;
    case 'airTemp':
      return d > 0 ? 'the air grew hotter' : 'the air cooled';
    case 'oxygen':
      return d < 0 ? (d <= -20 ? 'oxygen fell sharply' : 'oxygen fell') : 'oxygen recovered';
    case 'nutrients':
      return d > 0 ? 'nutrients rose' : 'nutrients eased';
    case 'pathogens':
      return d > 0 ? 'germs in the water rose' : 'germs in the water fell';
    case 'flow':
      return d < 0 ? (c.to < 20 ? 'the flow slowed to a trickle' : 'the flow slowed') : c.to > 85 ? 'the flow surged' : 'the flow picked up';
    case 'shade':
      return d < 0 ? (c.to < 0.1 ? 'the shade disappeared' : 'shade was lost') : 'shade began to return';
    case 'algae':
      return d > 0 ? (c.to >= 0.6 ? 'algae bloomed' : 'algae spread') : 'algae fell back';
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SINGULAR: Record<SpeciesId, string> = { mayfly: 'mayfly', midge: 'midge', mosquito: 'mosquito', fish: 'fish' };

function speciesPhrase(c: SpeciesChange): string {
  const plural = SPECIES[c.species].plural;
  if (c.to === 0) return `${plural} have disappeared`;
  if (c.from === 0) return c.species === 'mosquito' ? 'mosquito larvae have appeared' : `${plural} have returned`;
  const ratio = c.to / c.from;
  if (ratio >= 3) return `${SINGULAR[c.species]} numbers have tripled`;
  if (ratio >= 1.8) return `${SINGULAR[c.species]} numbers have doubled`;
  if (ratio <= 0.55) return `${SINGULAR[c.species]} numbers have halved`;
  return ratio > 1 ? `${plural} have increased` : `${plural} have declined`;
}

/** Whether the species changes named in the sentence themselves explain a change in human health risk. */
function speciesDriveRisk(named: SpeciesChange[], up: boolean): boolean {
  return named.some((c) =>
    up
      ? (c.species === 'mosquito' && c.to > c.from) || (c.species === 'fish' && c.to < c.from)
      : (c.species === 'mosquito' && c.to < c.from) || (c.species === 'fish' && c.to > c.from),
  );
}

function healthClause(facts: CauseFacts, hasSpecies: boolean, named: SpeciesChange[] = []): string {
  const r = facts.gauges.find((g) => g.gauge === 'risk');
  const delta = r ? r.to - r.from : 0;
  const top = facts.risk.topKey === 'none' ? '' : `, mainly from ${facts.risk.topPhrase}`;
  if (delta >= 4) {
    if (!hasSpecies) return `The health risk for people nearby has risen${top}`;
    return speciesDriveRisk(named, true)
      ? `, which raises the health risk for people nearby${top}`
      : `; meanwhile the health risk for people nearby has risen${top}`;
  }
  if (delta <= -4) {
    if (!hasSpecies) return 'The health risk for people nearby has fallen';
    return speciesDriveRisk(named, false) ? ', which lowers the health risk for people nearby' : '; meanwhile the health risk for people nearby has fallen';
  }
  const stays = facts.risk.band === 'low' ? 'stays low for now' : `stays ${facts.risk.band}${top}`;
  return hasSpecies ? `; the health risk for people nearby ${stays}` : `The health risk for people nearby ${stays}`;
}

/** One or two sentences: cause, effect on the water and wildlife, health consequence. */
export function narrate(facts: CauseFacts): string {
  if (facts.trigger === 'band' && facts.bandGauge) return narrateBand(facts);

  // The changes include the effects of any stressor that overlapped this one, so name them too.
  const during = (facts.during ?? []).slice(0, 2);
  const later = (facts.later ?? []).slice(0, 2);
  let cause = facts.stressor ? CAUSE[facts.stressor] : 'The stream has been changing on its own';
  if (facts.stressor && during.length) cause += ` while ${during.map((k) => THEN[k]).join(' and ')}`;
  if (facts.stressor && later.length) cause += `, then ${later.map((k) => THEN[k]).join(' and ')}`;
  const vars = facts.variables.slice(0, 2).map(variablePhrase);
  const first = vars.length
    ? `${cause}, so ${vars.join(' and ')}.`
    : `${cause}, but the water has not changed much yet.`;

  // Each phrase keeps the species change it reports, if any, so the health clause
  // only draws a causal link from changes the sentence actually names.
  const sp: Array<{ text: string; change?: SpeciesChange }> = facts.species.slice(0, 2).map((c) => ({ text: speciesPhrase(c), change: c }));
  const drain = facts.nearDrain.find((c) => !facts.species.some((x) => x.species === c.species));
  if (drain && sp.length < 2) {
    sp.unshift({ text: `${SPECIES[drain.species].plural} have ${drain.to === 0 ? 'vanished from' : 'fled'} the water near the drain` });
  }
  if (facts.washedOut >= 3) {
    sp.unshift({ text: `${facts.washedOut} small creatures were washed away` });
    if (sp.length > 2) sp.length = 2;
  }
  const stressedFish = facts.stressed.includes('fish') && !facts.species.some((c) => c.species === 'fish');
  if (stressedFish && sp.length < 2) sp.push({ text: 'fish are stressed' });
  if (!sp.length && facts.stressed.length) {
    sp.push({ text: `${SPECIES[facts.stressed[0]].plural.toLowerCase()} are struggling` });
  }

  let second: string;
  if (sp.length) {
    const species = upperFirst(sp.map((p, i) => (i === 0 ? p.text : lowerFirst(p.text))).join(' and '));
    const named = sp.flatMap((p) => (p.change ? [p.change] : []));
    second = `${species}${healthClause(facts, true, named)}.`;
  } else {
    second = `${healthClause(facts, false)}.`;
  }
  return `${first} ${second}`;
}

function narrateBand(facts: CauseFacts): string {
  const g = facts.gauges.find((x) => x.gauge === facts.bandGauge)!;
  const labels: Record<GaugeId, string> = { ecosystem: 'Ecosystem health', biodiversity: 'Biodiversity', risk: 'Human health risk' };
  const direction = rankBand(g.toBand) > rankBand(g.fromBand) ? 'risen' : 'dropped';
  const first = `${labels[g.gauge]} has ${direction} to ${g.toBand}, mainly ${g.gauge === 'risk' ? 'from ' : ''}${g.topPhrase}.`;
  const after = facts.stressor ? ` This follows the ${STRESSORS[facts.stressor].label.toLowerCase()}.` : '';
  return first + after;
}

function rankBand(b: string): number {
  return b === 'low' ? 0 : b === 'moderate' ? 1 : 2;
}

/** Said the moment a stressor is applied. */
export function announce(kind: StressorKind, detail: string): string {
  return `${STRESSORS[kind].label}: ${detail} ${WATCH[kind]}`;
}
