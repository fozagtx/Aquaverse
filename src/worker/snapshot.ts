import { STRESSORS, TICKS_PER_SECOND } from '../engine/constants';
import type { SimulationRuntime } from '../engine/runtime';
import { countSpecies } from '../engine/simulation';
import { ACTION_KINDS, SPECIES_IDS, STRESS_REASONS, type Gauges, type World } from '../engine/types';
import { ORG_FIELDS, type Snapshot, type TerrainPayload } from './protocol';

export function terrainPayload(w: World): TerrainPayload {
  return {
    version: w.terrainVersion,
    width: w.width,
    height: w.height,
    terrain: w.terrain.slice(),
    drain: w.drain.slice(),
    treeGrowth: w.treeGrowth.slice(),
    flowFactor: w.flowFactor.slice(),
    localShade: w.localShade.slice(),
  };
}

function quantize(src: Float32Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(src[i] * 255)));
  return out;
}

const MOVE_EVERY = { fish: 2, mayfly: 4, midge: 5, mosquito: 6 } as const;

export function packOrganisms(w: World): Float32Array {
  const out = new Float32Array(w.organisms.length * ORG_FIELDS);
  let k = 0;
  for (const o of w.organisms) {
    out[k++] = o.id;
    out[k++] = SPECIES_IDS.indexOf(o.species);
    out[k++] = o.x;
    out[k++] = o.y;
    out[k++] = o.px;
    out[k++] = o.py;
    out[k++] = o.energy;
    out[k++] = ACTION_KINDS.indexOf(o.action);
    out[k++] = o.stress;
    out[k++] = STRESS_REASONS.indexOf(o.stressReason);
    out[k++] = o.age;
    out[k++] = o.maxAge;
    out[k++] = o.tolerance;
    out[k++] = o.generation;
    out[k++] = 1 - Math.max(0, o.moveTimer - 1) / MOVE_EVERY[o.species];
  }
  return out;
}

export interface SnapshotOptions {
  world: World;
  gauges: Gauges;
  liveGauges?: Gauges;
  live: boolean;
  playing: boolean;
  speed: number;
  includeTerrain: boolean;
  runtime: SimulationRuntime;
}

export function buildSnapshot(o: SnapshotOptions): Snapshot {
  const { world } = o;
  const ticks = o.runtime.frameTicks();
  return {
    tick: world.tick,
    live: o.live,
    playing: o.playing,
    speed: o.speed,
    terrainVersion: world.terrainVersion,
    terrain: o.includeTerrain ? terrainPayload(world) : undefined,
    algae: quantize(world.algae),
    plume: quantize(world.plume),
    organisms: packOrganisms(world),
    stream: { ...world.stream },
    gauges: o.gauges,
    liveGauges: o.liveGauges,
    counts: countSpecies(world),
    effects: world.effects
      .filter((e) => e.endTick > world.tick)
      .map((e) => ({ kind: e.kind, remaining: (e.endTick - world.tick) / TICKS_PER_SECOND, duration: STRESSORS[e.kind].duration })),
    surge: world.surge,
    timeline: { firstTick: ticks[0] ?? 0, liveTick: o.runtime.tick },
  };
}
