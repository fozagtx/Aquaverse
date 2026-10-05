import type { RngState } from './rng';
import {
  ACTION_KINDS,
  SPECIES_IDS,
  STRESS_REASONS,
  type ActiveEffect,
  type Organism,
  type StreamState,
  type World,
  type WorldStats,
} from './types';

/**
 * Replay frames: compact, exact copies of the world. Terrain layers are shared
 * between frames until the terrain changes, so frames stay small.
 */

export interface TerrainSnap {
  version: number;
  terrain: Uint8Array;
  drain: Uint8Array;
  treeGrowth: Float32Array;
  channel: Int32Array;
  flowFactor: Float32Array;
  localShade: Float32Array;
}

export interface Frame {
  tick: number;
  rng: RngState;
  stream: StreamState;
  surge: number;
  effects: ActiveEffect[];
  nextId: number;
  stats: WorldStats;
  terrain: TerrainSnap;
  /** Algae and plume for channel tiles only, in `terrain.channel` order. */
  algae: Float32Array;
  plume: Float32Array;
  organisms: Float64Array;
}

const FIELDS = 20;

export function snapTerrain(world: World, previous?: TerrainSnap): TerrainSnap {
  if (previous && previous.version === world.terrainVersion) return previous;
  return {
    version: world.terrainVersion,
    terrain: world.terrain.slice(),
    drain: world.drain.slice(),
    treeGrowth: world.treeGrowth.slice(),
    channel: world.channel.slice(),
    flowFactor: world.flowFactor.slice(),
    localShade: world.localShade.slice(),
  };
}

export function packOrganisms(list: Organism[]): Float64Array {
  const out = new Float64Array(list.length * FIELDS);
  let k = 0;
  for (const o of list) {
    out[k++] = o.id;
    out[k++] = SPECIES_IDS.indexOf(o.species);
    out[k++] = o.x;
    out[k++] = o.y;
    out[k++] = o.px;
    out[k++] = o.py;
    out[k++] = o.energy;
    out[k++] = o.age;
    out[k++] = o.maxAge;
    out[k++] = o.tolerance;
    out[k++] = o.generation;
    out[k++] = ACTION_KINDS.indexOf(o.action);
    out[k++] = o.targetX;
    out[k++] = o.targetY;
    out[k++] = o.targetId;
    out[k++] = o.moveTimer;
    out[k++] = o.decideTimer;
    out[k++] = o.mateCooldown;
    out[k++] = o.stress;
    out[k++] = STRESS_REASONS.indexOf(o.stressReason);
  }
  return out;
}

export function unpackOrganisms(data: Float64Array): Organism[] {
  const out: Organism[] = [];
  for (let k = 0; k < data.length; k += FIELDS) {
    out.push({
      id: data[k],
      species: SPECIES_IDS[data[k + 1]],
      x: data[k + 2],
      y: data[k + 3],
      px: data[k + 4],
      py: data[k + 5],
      energy: data[k + 6],
      age: data[k + 7],
      maxAge: data[k + 8],
      tolerance: data[k + 9],
      generation: data[k + 10],
      action: ACTION_KINDS[data[k + 11]],
      targetX: data[k + 12],
      targetY: data[k + 13],
      targetId: data[k + 14],
      moveTimer: data[k + 15],
      decideTimer: data[k + 16],
      mateCooldown: data[k + 17],
      stress: data[k + 18],
      stressReason: STRESS_REASONS[data[k + 19]],
    });
  }
  return out;
}

function cloneStats(s: WorldStats): WorldStats {
  return JSON.parse(JSON.stringify(s)) as WorldStats;
}

export function captureFrame(world: World, previousTerrain?: TerrainSnap): Frame {
  const terrain = snapTerrain(world, previousTerrain);
  const n = world.channel.length;
  const algae = new Float32Array(n);
  const plume = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = world.channel[k];
    algae[k] = world.algae[i];
    plume[k] = world.plume[i];
  }
  return {
    tick: world.tick,
    rng: [...world.rng] as RngState,
    stream: { ...world.stream },
    surge: world.surge,
    effects: world.effects.map((e) => ({ ...e })),
    nextId: world.nextId,
    stats: cloneStats(world.stats),
    terrain,
    algae,
    plume,
    organisms: packOrganisms(world.organisms),
  };
}

/** Writes a frame back into a world (which keeps its profile and size). */
export function restoreFrame(world: World, frame: Frame): void {
  const t = frame.terrain;
  world.tick = frame.tick;
  world.rng = [...frame.rng] as RngState;
  world.stream = { ...frame.stream };
  world.surge = frame.surge;
  world.effects = frame.effects.map((e) => ({ ...e }));
  world.nextId = frame.nextId;
  world.stats = cloneStats(frame.stats);
  world.terrain = t.terrain.slice();
  world.drain = t.drain.slice();
  world.treeGrowth = t.treeGrowth.slice();
  world.channel = t.channel.slice();
  world.flowFactor = t.flowFactor.slice();
  world.localShade = t.localShade.slice();
  world.terrainVersion = t.version;
  world.algae = new Float32Array(world.width * world.height);
  world.plume = new Float32Array(world.width * world.height);
  for (let k = 0; k < t.channel.length; k++) {
    const i = t.channel[k];
    world.algae[i] = frame.algae[k];
    world.plume[i] = frame.plume[k];
  }
  world.organisms = unpackOrganisms(frame.organisms);
}

/** A read-only world built from a frame, for viewing the past. */
export function worldFromFrame(template: World, frame: Frame): World {
  const w: World = { ...template, organisms: [], effects: [] };
  restoreFrame(w, frame);
  // Terrain arrays can be shared when only viewing.
  w.terrainVersion = frame.terrain.version;
  return w;
}
