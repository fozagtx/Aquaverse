import type { RngState } from './rng';

/** Terrain codes stored in `World.terrain`. */
export const TERRAIN = {
  water: 0,
  refuge: 1,
  bank: 2,
  trees: 3,
  pavement: 4,
} as const;
export type TerrainKind = keyof typeof TERRAIN;
export type TerrainCode = (typeof TERRAIN)[TerrainKind];
export const TERRAIN_KINDS: TerrainKind[] = ['water', 'refuge', 'bank', 'trees', 'pavement'];

export type SpeciesId = 'mayfly' | 'midge' | 'mosquito' | 'fish';
export const SPECIES_IDS: SpeciesId[] = ['mayfly', 'midge', 'mosquito', 'fish'];

export type StressorKind = 'heatwave' | 'drought' | 'storm' | 'sewage' | 'clearTrees' | 'plantTrees';
export const STRESSOR_KINDS: StressorKind[] = ['heatwave', 'drought', 'storm', 'sewage', 'clearTrees', 'plantTrees'];

export type DeathCause = 'starvation' | 'poorWater' | 'predation' | 'oldAge' | 'washedOut';
export const DEATH_CAUSES: DeathCause[] = ['starvation', 'poorWater', 'predation', 'oldAge', 'washedOut'];

export type ActionKind =
  | 'explore'
  | 'rest'
  | 'forage'
  | 'flee'
  | 'hide'
  | 'mate'
  | 'seekWater'
  | 'hunt';
export const ACTION_KINDS: ActionKind[] = ['explore', 'rest', 'forage', 'flee', 'hide', 'mate', 'seekWater', 'hunt'];

export type StressReason = 'oxygen' | 'temperature' | 'cold' | 'flow' | 'none';
export const STRESS_REASONS: StressReason[] = ['none', 'oxygen', 'temperature', 'cold', 'flow'];

export interface Organism {
  id: number;
  species: SpeciesId;
  x: number;
  y: number;
  /** Position before the last move, used by the renderer to interpolate. */
  px: number;
  py: number;
  energy: number;
  /** Age in ticks. */
  age: number;
  maxAge: number;
  /** Inherited pollution tolerance, 0 to 1. Lowers needs, costs energy. */
  tolerance: number;
  generation: number;
  action: ActionKind;
  targetX: number;
  targetY: number;
  /** Id of the organism this one is chasing or courting, or -1. */
  targetId: number;
  moveTimer: number;
  decideTimer: number;
  mateCooldown: number;
  /** Shortfall against the species' needs on the last tick, 0 to 1. */
  stress: number;
  stressReason: StressReason;
}

export interface StreamState {
  /** Air temperature in °C. */
  airTemp: number;
  baseAirTemp: number;
  /** Water temperature in °C. */
  waterTemp: number;
  /** 0 to 100. */
  flow: number;
  baseFlow: number;
  nutrients: number;
  /** Nutrient level the stream settles back to without stress. */
  baseNutrients: number;
  oxygen: number;
  pathogens: number;
  basePathogens: number;
  /** Decomposing organic matter (sewage, dead algae), 0 to 100. Uses oxygen. */
  organicLoad: number;
  baseOrganicLoad: number;
  /** Suspended sediment after storms, 0 to 100. */
  turbidity: number;
  /** Share of bank beside the channel covered by grown trees, 0 to 1. */
  shade: number;
  /** How much runoff the banks filter, 0 to 1. Comes from bank vegetation. */
  filtering: number;
  /** Share of the surroundings that is paved, 0 to 1. */
  pavement: number;
  /** Filtering and paved share when the stream was created; runoff is judged against them. */
  baseFiltering: number;
  basePavement: number;
  /** Mean algae on water tiles, 0 to 1 (1 = algae at capacity everywhere). */
  meanAlgae: number;
  /** 0 to 1, how far algae is into bloom territory. */
  bloom: number;
  /** Adult mosquitoes flying near the banks (emerged larvae). */
  adultMosquitoes: number;
}

export interface ActiveEffect {
  kind: StressorKind;
  startTick: number;
  endTick: number;
}

export interface WorldStats {
  births: Record<SpeciesId, number>;
  deaths: Record<SpeciesId, Record<DeathCause, number>>;
  arrivals: Record<SpeciesId, number>;
  emerged: number;
}

export type StreamAnswerKey = 'clarity' | 'smell' | 'banks' | 'creatures' | 'flow';
export interface StreamAnswers {
  clarity: 'clear' | 'cloudy' | 'murky' | 'unsure';
  smell: 'none' | 'earthy' | 'sewage' | 'unsure';
  banks: 'trees' | 'bushes' | 'grass' | 'concrete' | 'unsure';
  creatures: 'many' | 'few' | 'worms' | 'unsure';
  flow: 'fast' | 'slow' | 'still' | 'unsure';
}

export interface StreamProfile {
  answers: StreamAnswers;
  nutrients: number;
  algae: number;
  turbidity: number;
  pathogens: number;
  organicLoad: number;
  treeCover: number;
  pavement: number;
  flow: number;
  population: Record<SpeciesId, number>;
  /** Plain-language notes, e.g. which answers used a middle value. */
  notes: string[];
}

export interface RunConfig {
  seed: number;
  answers: StreamAnswers;
}

export interface World {
  width: number;
  height: number;
  tick: number;
  seed: number;
  rng: RngState;
  terrain: Uint8Array;
  /** 1 where a storm drain outfall sits. */
  drain: Uint8Array;
  /** Tree size for `trees` tiles, 0 to 1 (newly planted trees start small). */
  treeGrowth: Float32Array;
  /** Algae on channel tiles, 0 to 1. */
  algae: Float32Array;
  /** Pollution plume from the drain, 0 to 1, carried downstream. */
  plume: Float32Array;
  /** Local flow multiplier: slow at the edges and in pools, fast mid-channel. */
  flowFactor: Float32Array;
  /** Local shade on channel tiles, 0 to 1. */
  localShade: Float32Array;
  /** Indices of channel tiles (water and refuge). */
  channel: Int32Array;
  terrainVersion: number;
  stream: StreamState;
  organisms: Organism[];
  nextId: number;
  effects: ActiveEffect[];
  /** Flow surge left from a storm, 0 to 1, decays over time. */
  surge: number;
  profile: StreamProfile;
  stats: WorldStats;
}

export type GaugeId = 'ecosystem' | 'biodiversity' | 'risk';
export type Band = 'low' | 'moderate' | 'high';

export interface GaugeFactor {
  key: string;
  /** Short phrase used after "mainly", e.g. "low oxygen". */
  phrase: string;
  /** 0 to 1 contribution to the gauge (for risk) or drag on it (for health). */
  weight: number;
}

export interface Gauge {
  id: GaugeId;
  label: string;
  value: number;
  band: Band;
  /** The factor that explains the gauge best right now. */
  top: GaugeFactor;
  factors: GaugeFactor[];
}

export interface Gauges {
  ecosystem: Gauge;
  biodiversity: Gauge;
  risk: Gauge;
}

export type VariableKey = 'waterTemp' | 'oxygen' | 'nutrients' | 'pathogens' | 'flow' | 'shade' | 'algae' | 'airTemp';

export interface VariableChange {
  key: VariableKey;
  from: number;
  to: number;
}

export interface SpeciesChange {
  species: SpeciesId;
  from: number;
  to: number;
}

export interface GaugeChange {
  gauge: GaugeId;
  from: number;
  to: number;
  fromBand: Band;
  toBand: Band;
  topPhrase: string;
}

/** Structured explanation of what changed and why. The narrator turns it into words. */
export interface CauseFacts {
  trigger: 'stressor' | 'followUp' | 'band';
  stressor: StressorKind | null;
  /**
   * Other stressors whose effects are mixed into the changes: still running
   * when this one began, or applied since.
   */
  during?: StressorKind[];
  later?: StressorKind[];
  secondsSince: number;
  variables: VariableChange[];
  species: SpeciesChange[];
  /** Changes in the stretch of water just downstream of the storm drain. */
  nearDrain: SpeciesChange[];
  /** Small creatures washed away by a flood surge since the stressor. */
  washedOut: number;
  /** Species whose members are, on average, clearly stressed right now. */
  stressed: SpeciesId[];
  gauges: GaugeChange[];
  /** Human health risk at the time of the explanation. */
  risk: { value: number; band: Band; topKey: string; topPhrase: string };
  /** Gauge that crossed a band, for band triggers. */
  bandGauge?: GaugeId;
}

export type LogKind = 'stressor' | 'narration' | 'species' | 'info' | 'edit';

export interface LogEntry {
  id: number;
  tick: number;
  kind: LogKind;
  text: string;
  stressor?: StressorKind;
  facts?: CauseFacts;
}

export interface HistoryPoint {
  tick: number;
  counts: Record<SpeciesId, number>;
  adultMosquitoes: number;
  waterTemp: number;
  airTemp: number;
  oxygen: number;
  nutrients: number;
  pathogens: number;
  flow: number;
  shade: number;
  algae: number;
  ecosystem: number;
  biodiversity: number;
  risk: number;
  tolerance: Record<SpeciesId, number>;
}

export interface MapEdit {
  x: number;
  y: number;
  brush: TerrainKind | 'drain';
}

export type ScriptStep =
  | { tick: number; kind: 'stressor'; stressor: StressorKind }
  | { tick: number; kind: 'edit'; edits: MapEdit[] };

export interface RunExport {
  app: 'aquaverse';
  version: 1;
  seed: number;
  answers: StreamAnswers;
  script: ScriptStep[];
  endTick: number;
}
