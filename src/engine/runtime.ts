import {
  FRAME_EVERY_TICKS,
  HISTORY_EVERY_TICKS,
  MAX_FRAMES,
  SPECIES,
  STRESSORS,
  TICKS_PER_SECOND,
} from './constants';
import { announce, buildFacts, narrate, takeSample, type Sample } from './narrator';
import { bandOf, computeGauges } from './oneHealth';
import { captureFrame, restoreFrame, worldFromFrame, type Frame, type TerrainSnap } from './replay';
import { countSpecies, createWorld, meanTolerance, stepWorld } from './simulation';
import { startStressor } from './stream';
import { applyEdits } from './terrain';
import {
  SPECIES_IDS,
  STRESSOR_KINDS,
  type Band,
  type GaugeId,
  type Gauges,
  type HistoryPoint,
  type LogEntry,
  type MapEdit,
  type RunConfig,
  type RunExport,
  type ScriptStep,
  type SpeciesId,
  type StressorKind,
  type World,
} from './types';
import { isValidAnswers } from './streamProfile';

interface FollowUp {
  due: number;
  stressor: StressorKind;
  baseline: Sample;
}

/** Runtime state that must rewind together with the world. */
interface Bookmark {
  frame: Frame;
  logLength: number;
  historyLength: number;
  scriptLength: number;
  followUps: FollowUp[];
  lastStressor: { kind: StressorKind; tick: number } | null;
  bands: Record<GaugeId, Band>;
  lastBandTick: number;
  present: Record<SpeciesId, boolean>;
  absentFor: Record<SpeciesId, number>;
  nextLogId: number;
}

/** Seconds after a stressor when the narrator explains what happened. */
export const FOLLOW_UP_SECONDS: Record<StressorKind, number[]> = {
  heatwave: [20, 50],
  drought: [20, 50],
  storm: [10, 45],
  sewage: [20, 50],
  clearTrees: [20, 50],
  plantTrees: [25, 55],
};

function washedOutTotal(world: World): number {
  let n = 0;
  for (const s of SPECIES_IDS) n += world.stats.deaths[s].washedOut;
  return n;
}

/** Animals in the stretch just downstream of any storm drain. */
export function countNearDrain(world: World): Record<SpeciesId, number> {
  const out = { mayfly: 0, midge: 0, mosquito: 0, fish: 0 } as Record<SpeciesId, number>;
  const drains: Array<[number, number]> = [];
  for (let i = 0; i < world.drain.length; i++) if (world.drain[i]) drains.push([i % world.width, (i / world.width) | 0]);
  if (!drains.length) return out;
  for (const o of world.organisms) {
    for (const [dx, dy] of drains) {
      if (o.x >= dx - 1 && o.x <= dx + 12 && Math.abs(o.y - dy) <= 8) {
        out[o.species]++;
        break;
      }
    }
  }
  return out;
}

export class SimulationRuntime {
  world: World;
  readonly config: RunConfig;
  log: LogEntry[] = [];
  history: HistoryPoint[] = [];
  bookmarks: Bookmark[] = [];
  /** Everything the user did, for export and exact reproduction. */
  script: ScriptStep[] = [];
  private pending: ScriptStep[];
  private followUps: FollowUp[] = [];
  private lastStressor: { kind: StressorKind; tick: number } | null = null;
  private bands: Record<GaugeId, Band>;
  private lastBandTick = -1000;
  private present: Record<SpeciesId, boolean>;
  private absentFor: Record<SpeciesId, number> = { mayfly: 0, midge: 0, mosquito: 0, fish: 0 };
  private nextLogId = 1;
  private lastTerrain?: TerrainSnap;
  private maxTerrainVersion = 1;
  gauges: Gauges;

  constructor(config: RunConfig, script: ScriptStep[] = []) {
    this.config = { seed: config.seed >>> 0, answers: { ...config.answers } };
    this.world = createWorld(this.config);
    this.pending = [...script].sort((a, b) => a.tick - b.tick);
    this.gauges = computeGauges({ stream: this.world.stream, counts: countSpecies(this.world) });
    this.bands = { ecosystem: this.gauges.ecosystem.band, biodiversity: this.gauges.biodiversity.band, risk: this.gauges.risk.band };
    const counts = countSpecies(this.world);
    this.present = Object.fromEntries(SPECIES_IDS.map((s) => [s, counts[s] > 0])) as Record<SpeciesId, boolean>;
    this.recordHistory();
    this.captureBookmark();
  }

  static fromExport(data: RunExport): SimulationRuntime {
    return new SimulationRuntime({ seed: data.seed, answers: data.answers }, data.script);
  }

  get tick(): number {
    return this.world.tick;
  }

  get seconds(): number {
    return this.world.tick / TICKS_PER_SECOND;
  }

  counts(): Record<SpeciesId, number> {
    return countSpecies(this.world);
  }

  meanStress(world: World = this.world): Record<SpeciesId, number> {
    const sum = { mayfly: 0, midge: 0, mosquito: 0, fish: 0 } as Record<SpeciesId, number>;
    const n = { mayfly: 0, midge: 0, mosquito: 0, fish: 0 } as Record<SpeciesId, number>;
    for (const o of world.organisms) {
      sum[o.species] += o.stress;
      n[o.species]++;
    }
    for (const s of SPECIES_IDS) sum[s] = n[s] ? sum[s] / n[s] : 0;
    return sum;
  }

  sample(): Sample {
    return takeSample(
      this.world.tick,
      this.world.stream,
      this.counts(),
      countNearDrain(this.world),
      washedOutTotal(this.world),
      this.meanStress(),
      this.gauges,
    );
  }

  /** Advances the simulation by one tick and does the bookkeeping. */
  step(): LogEntry[] {
    const added: LogEntry[] = [];
    while (this.pending.length && this.pending[0].tick <= this.world.tick) {
      const step = this.pending.shift()!;
      if (step.kind === 'stressor') added.push(...this.applyStressor(step.stressor));
      else added.push(...this.applyEdits(step.edits));
    }

    stepWorld(this.world);
    const t = this.world.tick;

    if (t % HISTORY_EVERY_TICKS === 0) {
      this.gauges = computeGauges({ stream: this.world.stream, counts: this.counts() });
      this.recordHistory();
      added.push(...this.checkSpecies());
      added.push(...this.checkBands());
    }

    const due = this.followUps.filter((f) => f.due <= t);
    if (due.length) {
      this.followUps = this.followUps.filter((f) => f.due > t);
      this.gauges = computeGauges({ stream: this.world.stream, counts: this.counts() });
      const now = this.sample();
      for (const f of due) {
        const facts = buildFacts('followUp', f.stressor, f.baseline, now, TICKS_PER_SECOND);
        added.push(this.addLog({ kind: 'narration', text: narrate(facts), facts, stressor: f.stressor }));
      }
    }

    if (t % FRAME_EVERY_TICKS === 0) this.captureBookmark();
    return added;
  }

  /** Applies a stressor: timed effect, log entry, replay frame and explanations later. */
  applyStressor(kind: StressorKind): LogEntry[] {
    if (!STRESSOR_KINDS.includes(kind)) return [];
    // A frame just before the stressor, so the user can rewind to "before".
    this.captureBookmark();
    this.gauges = computeGauges({ stream: this.world.stream, counts: this.counts() });
    const baseline = this.sample();
    const detail = startStressor(this.world, kind);
    this.script.push({ tick: this.world.tick, kind: 'stressor', stressor: kind });
    this.lastStressor = { kind, tick: this.world.tick };
    // A repeated stressor replaces its earlier explanations.
    this.followUps = this.followUps.filter((f) => f.stressor !== kind);
    for (const s of FOLLOW_UP_SECONDS[kind]) {
      this.followUps.push({ due: this.world.tick + s * TICKS_PER_SECOND, stressor: kind, baseline });
    }
    if (this.followUps.length > 6) this.followUps = this.followUps.slice(-6);
    this.gauges = computeGauges({ stream: this.world.stream, counts: this.counts() });
    return [this.addLog({ kind: 'stressor', text: announce(kind, detail), stressor: kind })];
  }

  applyEdits(edits: MapEdit[]): LogEntry[] {
    const changed = applyEdits(this.world, edits);
    if (!changed) return [];
    this.maxTerrainVersion = Math.max(this.maxTerrainVersion, this.world.terrainVersion);
    this.script.push({ tick: this.world.tick, kind: 'edit', edits: edits.map((e) => ({ ...e })) });
    this.gauges = computeGauges({ stream: this.world.stream, counts: this.counts() });
    return [this.addLog({ kind: 'edit', text: `The map was edited (${changed} tile${changed === 1 ? '' : 's'} changed).` })];
  }

  private addLog(e: Omit<LogEntry, 'id' | 'tick'>): LogEntry {
    const entry: LogEntry = { id: this.nextLogId++, tick: this.world.tick, ...e };
    this.log.push(entry);
    return entry;
  }

  private recordHistory(): void {
    const s = this.world.stream;
    this.history.push({
      tick: this.world.tick,
      counts: this.counts(),
      adultMosquitoes: Math.round(s.adultMosquitoes * 10) / 10,
      waterTemp: s.waterTemp,
      airTemp: s.airTemp,
      oxygen: s.oxygen,
      nutrients: s.nutrients,
      pathogens: s.pathogens,
      flow: s.flow,
      shade: s.shade,
      algae: s.meanAlgae,
      ecosystem: this.gauges.ecosystem.value,
      biodiversity: this.gauges.biodiversity.value,
      risk: this.gauges.risk.value,
      tolerance: meanTolerance(this.world),
    });
  }

  private checkSpecies(): LogEntry[] {
    const counts = this.counts();
    const out: LogEntry[] = [];
    for (const s of SPECIES_IDS) {
      // Small populations blink in and out; only report lasting changes.
      this.absentFor[s] = counts[s] === 0 ? this.absentFor[s] + 1 : 0;
      const now = this.present[s] ? this.absentFor[s] < 5 : counts[s] >= 3;
      if (now === this.present[s]) continue;
      this.present[s] = now;
      const name = SPECIES[s].plural;
      const text = now
        ? s === 'mosquito'
          ? 'Mosquito larvae have appeared in the still water.'
          : `${name} have arrived from upstream.`
        : `${name} have disappeared from the stream.`;
      out.push(this.addLog({ kind: 'species', text }));
    }
    return out;
  }

  private checkBands(): LogEntry[] {
    const out: LogEntry[] = [];
    const t = this.world.tick;
    for (const id of ['ecosystem', 'biodiversity', 'risk'] as GaugeId[]) {
      const g = this.gauges[id];
      const prev = this.bands[id];
      const next = stableBand(g.value, prev);
      if (next === prev) continue;
      this.bands[id] = next;
      if (t - this.lastBandTick < 8 * TICKS_PER_SECOND) continue;
      this.lastBandTick = t;
      const recent = this.lastStressor && t - this.lastStressor.tick < 90 * TICKS_PER_SECOND ? this.lastStressor : null;
      const before = this.history[Math.max(0, this.history.length - 21)];
      const baseline: Sample = {
        tick: before.tick,
        stream: {
          waterTemp: before.waterTemp,
          airTemp: before.airTemp,
          oxygen: before.oxygen,
          nutrients: before.nutrients,
          pathogens: before.pathogens,
          flow: before.flow,
          shade: before.shade,
          meanAlgae: before.algae,
          bloom: 0,
        },
        counts: before.counts,
        nearDrain: countNearDrain(this.world),
        washedOut: washedOutTotal(this.world),
        stress: this.meanStress(),
        gauges: {
          ecosystem: { value: before.ecosystem, topPhrase: '', topKey: '' },
          biodiversity: { value: before.biodiversity, topPhrase: '', topKey: '' },
          risk: { value: before.risk, topPhrase: '', topKey: '' },
        },
      };
      // Make sure the band change itself shows up in the facts.
      baseline.gauges[id].value = bandFloor(prev);
      const facts = buildFacts('band', recent?.kind ?? null, baseline, this.sample(), TICKS_PER_SECOND, id);
      out.push(this.addLog({ kind: 'narration', text: narrate(facts), facts, stressor: recent?.kind }));
    }
    return out;
  }

  private captureBookmark(): void {
    const last = this.bookmarks[this.bookmarks.length - 1];
    if (last && last.frame.tick === this.world.tick) this.bookmarks.pop();
    const frame = captureFrame(this.world, this.lastTerrain);
    this.lastTerrain = frame.terrain;
    this.bookmarks.push({
      frame,
      logLength: this.log.length,
      historyLength: this.history.length,
      scriptLength: this.script.length,
      followUps: this.followUps.map((f) => ({ ...f })),
      lastStressor: this.lastStressor ? { ...this.lastStressor } : null,
      bands: { ...this.bands },
      lastBandTick: this.lastBandTick,
      present: { ...this.present },
      absentFor: { ...this.absentFor },
      nextLogId: this.nextLogId,
    });
    if (this.bookmarks.length > MAX_FRAMES) thin(this.bookmarks);
  }

  frameTicks(): number[] {
    return this.bookmarks.map((b) => b.frame.tick);
  }

  /** The world as it was at a bookmark, without changing the live run. */
  viewAt(index: number): { world: World; gauges: Gauges } | null {
    const b = this.bookmarks[index];
    if (!b) return null;
    const world = worldFromFrame(this.world, b.frame);
    return { world, gauges: computeGauges({ stream: world.stream, counts: countSpecies(world) }) };
  }

  /** Rewinds the live run to a bookmark; everything after it is discarded. */
  rewindTo(index: number): boolean {
    const b = this.bookmarks[index];
    if (!b) return false;
    restoreFrame(this.world, b.frame);
    this.maxTerrainVersion = Math.max(this.maxTerrainVersion, this.world.terrainVersion) + 1;
    this.world.terrainVersion = this.maxTerrainVersion;
    this.lastTerrain = undefined;
    this.log = this.log.slice(0, b.logLength);
    this.history = this.history.slice(0, b.historyLength);
    this.script = this.script.slice(0, b.scriptLength);
    this.followUps = b.followUps.map((f) => ({ ...f }));
    this.lastStressor = b.lastStressor ? { ...b.lastStressor } : null;
    this.bands = { ...b.bands };
    this.lastBandTick = b.lastBandTick;
    this.present = { ...b.present };
    this.absentFor = { ...b.absentFor };
    this.nextLogId = b.nextLogId;
    this.bookmarks = this.bookmarks.slice(0, index + 1);
    // Rewinding means taking a different path, so steps left over from an imported run are dropped.
    this.pending = [];
    this.gauges = computeGauges({ stream: this.world.stream, counts: this.counts() });
    // Re-capture so the bookmark matches the new terrain version.
    this.bookmarks.pop();
    this.captureBookmark();
    return true;
  }

  exportRun(): RunExport {
    return {
      app: 'aquaverse',
      version: 1,
      seed: this.config.seed,
      answers: { ...this.config.answers },
      script: this.script.map((s) => (s.kind === 'edit' ? { ...s, edits: s.edits.map((e) => ({ ...e })) } : { ...s })),
      endTick: this.world.tick,
    };
  }

  stressorLabel(kind: StressorKind): string {
    return STRESSORS[kind].label;
  }
}

/** Keeps every frame from the last part of the run and every other frame before it. */
function thin(list: Bookmark[]): void {
  const keepRecent = Math.floor(MAX_FRAMES / 2);
  const cut = list.length - keepRecent;
  const older = list.slice(0, cut).filter((_, i) => i % 2 === 0);
  list.splice(0, cut, ...older);
}

function bandFloor(b: Band): number {
  return b === 'low' ? 20 : b === 'moderate' ? 50 : 80;
}

/** Band with a little hysteresis so a gauge sitting on a boundary does not flicker. */
export function stableBand(value: number, prev: Band): Band {
  const next = bandOf(value);
  if (next === prev) return prev;
  const margin = 2;
  if (prev === 'low' && value < 34 + margin) return prev;
  if (prev === 'high' && value >= 67 - margin) return prev;
  if (prev === 'moderate' && value >= 34 - margin && value < 67 + margin) return prev;
  return next;
}

export function parseRunExport(data: unknown): RunExport | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<RunExport>;
  if (d.app !== 'aquaverse' || d.version !== 1) return null;
  if (typeof d.seed !== 'number' || !isValidAnswers(d.answers)) return null;
  if (!Array.isArray(d.script) || typeof d.endTick !== 'number') return null;
  const script: ScriptStep[] = [];
  for (const s of d.script as ScriptStep[]) {
    if (!s || typeof s.tick !== 'number') return null;
    if (s.kind === 'stressor' && STRESSOR_KINDS.includes(s.stressor)) script.push({ tick: s.tick, kind: 'stressor', stressor: s.stressor });
    else if (s.kind === 'edit' && Array.isArray(s.edits)) script.push({ tick: s.tick, kind: 'edit', edits: s.edits.filter(validEdit) });
    else return null;
  }
  return { app: 'aquaverse', version: 1, seed: d.seed >>> 0, answers: d.answers!, script, endTick: Math.max(0, Math.min(d.endTick, 60 * 60 * TICKS_PER_SECOND)) };
}

function validEdit(e: unknown): e is MapEdit {
  if (!e || typeof e !== 'object') return false;
  const m = e as MapEdit;
  return (
    Number.isInteger(m.x) &&
    Number.isInteger(m.y) &&
    ['water', 'refuge', 'bank', 'trees', 'pavement', 'drain'].includes(m.brush)
  );
}
