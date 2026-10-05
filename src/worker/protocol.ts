import type {
  Gauges,
  HistoryPoint,
  LogEntry,
  MapEdit,
  RunConfig,
  RunExport,
  ScriptStep,
  SpeciesId,
  StreamState,
  StressorKind,
} from '../engine/types';

export interface TerrainPayload {
  version: number;
  width: number;
  height: number;
  terrain: Uint8Array;
  drain: Uint8Array;
  treeGrowth: Float32Array;
  flowFactor: Float32Array;
  localShade: Float32Array;
}

/** Numbers per organism in `Snapshot.organisms`. */
export const ORG_FIELDS = 15;
/** id, species, x, y, px, py, energy, action, stress, stressReason, age, maxAge, tolerance, generation, moveProgress */

export interface Snapshot {
  tick: number;
  live: boolean;
  playing: boolean;
  speed: number;
  terrainVersion: number;
  terrain?: TerrainPayload;
  algae: Uint8Array;
  plume: Uint8Array;
  organisms: Float32Array;
  stream: StreamState;
  gauges: Gauges;
  /** Present when viewing the past: the gauges of the live run, for comparison. */
  liveGauges?: Gauges;
  counts: Record<SpeciesId, number>;
  effects: Array<{ kind: StressorKind; remaining: number; duration: number }>;
  surge: number;
  timeline: { firstTick: number; liveTick: number };
}

export type ToWorker =
  | { type: 'init'; config: RunConfig; script?: ScriptStep[]; endTick?: number; play?: boolean }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; speed: number }
  | { type: 'stressor'; kind: StressorKind }
  | { type: 'edit'; edits: MapEdit[] }
  | { type: 'view'; tick: number }
  | { type: 'live' }
  | { type: 'rewind'; tick: number }
  | { type: 'export' };

export type FromWorker =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'data'; reset: boolean; history: HistoryPoint[]; log: LogEntry[] }
  | { type: 'export'; data: RunExport }
  | { type: 'progress'; done: number; total: number }
  | { type: 'error'; message: string };
