import {
  CATCH_CHANCE,
  MAX_ORGANISMS,
  PREY_ENERGY,
  SPECIES,
  STREAM_RULES as R,
  TICKS_PER_SECOND,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './constants';
import { shortfall } from './needs';
import { decide, type Observation } from './policy';
import { chance, jitter, nextFloat, pick, randInt, seedRng } from './rng';
import { advanceStream, initialStream, localConditions, targetOxygen, targetWaterTemp } from './stream';
import { buildProfile } from './streamProfile';
import { findRoute, generateTerrain, growTrees, moveTo, refreshDerived, refreshShade, walkable } from './terrain';
import {
  SPECIES_IDS,
  TERRAIN,
  type ActionKind,
  type DeathCause,
  type Organism,
  type RunConfig,
  type SpeciesId,
  type World,
  type WorldStats,
} from './types';

function emptyStats(): WorldStats {
  const perSpecies = <T>(f: () => T) =>
    Object.fromEntries(SPECIES_IDS.map((s) => [s, f()])) as Record<SpeciesId, T>;
  return {
    births: perSpecies(() => 0),
    arrivals: perSpecies(() => 0),
    deaths: perSpecies(() => ({ starvation: 0, poorWater: 0, predation: 0, oldAge: 0, washedOut: 0 })),
    emerged: 0,
  };
}

/** Builds the starting world for a seed and a set of stream check answers. */
export function createWorld(config: RunConfig, width = WORLD_WIDTH, height = WORLD_HEIGHT): World {
  const profile = buildProfile(config.answers);
  const layers = generateTerrain(config.seed, width, height, profile);
  const size = width * height;
  const world: World = {
    width,
    height,
    tick: 0,
    seed: config.seed,
    rng: seedRng(config.seed),
    terrain: layers.terrain,
    drain: layers.drain,
    treeGrowth: layers.treeGrowth,
    algae: new Float32Array(size),
    plume: new Float32Array(size),
    flowFactor: new Float32Array(size),
    localShade: new Float32Array(size),
    channel: new Int32Array(0),
    terrainVersion: 1,
    stream: initialStream(profile),
    organisms: [],
    nextId: 1,
    effects: [],
    surge: 0,
    profile,
    stats: emptyStats(),
  };
  refreshDerived(world);
  const s = world.stream;
  s.baseFiltering = s.filtering;
  s.basePavement = s.pavement;
  for (const i of world.channel) world.algae[i] = Math.min(1, profile.algae * (0.75 + 0.5 * nextFloat(world.rng)));
  s.meanAlgae = profile.algae;
  s.waterTemp = targetWaterTemp(s);
  s.oxygen = targetOxygen(s);

  for (const species of SPECIES_IDS) {
    const n = profile.population[species];
    for (let k = 0; k < n; k++) {
      const spot = randomSpot(world, species);
      if (!spot) break;
      const rules = SPECIES[species];
      spawn(world, species, spot[0], spot[1], {
        energy: 60 + 30 * nextFloat(world.rng),
        age: Math.floor(nextFloat(world.rng) * rules.maxAgeTicks * 0.55),
        tolerance: baseTolerance(world, species),
        generation: 0,
      });
    }
  }
  return world;
}

function baseTolerance(world: World, species: SpeciesId): number {
  const base = species === 'midge' ? 0.45 : species === 'mosquito' ? 0.5 : 0.2;
  return clamp01(base + 0.12 * jitter(world.rng));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A random channel tile suitable for a species (mosquitoes prefer slow edges). */
function randomSpot(world: World, species: SpeciesId): [number, number] | null {
  if (!world.channel.length) return null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const i = world.channel[Math.floor(nextFloat(world.rng) * world.channel.length)];
    if (species === 'mosquito' && world.flowFactor[i] > 0.5 && attempt < 11) continue;
    return [i % world.width, (i / world.width) | 0];
  }
  return null;
}

interface SpawnOptions {
  energy: number;
  age: number;
  tolerance: number;
  generation: number;
}

export function spawn(world: World, species: SpeciesId, x: number, y: number, o: SpawnOptions): Organism {
  const rules = SPECIES[species];
  const org: Organism = {
    id: world.nextId++,
    species,
    x,
    y,
    px: x,
    py: y,
    energy: o.energy,
    age: o.age,
    maxAge: Math.round(rules.maxAgeTicks * (0.85 + 0.3 * nextFloat(world.rng))),
    tolerance: o.tolerance,
    generation: o.generation,
    action: 'explore',
    targetX: x,
    targetY: y,
    targetId: -1,
    moveTimer: randInt(world.rng, 1, rules.moveEvery),
    decideTimer: randInt(world.rng, 0, rules.decideEvery),
    mateCooldown: Math.round(rules.mateCooldownTicks * 0.5 * nextFloat(world.rng)),
    stress: 0,
    stressReason: 'none',
  };
  world.organisms.push(org);
  return org;
}

/**
 * How many of each species the stream can currently support. Breeding slows
 * as a population approaches it. Mayflies need good water, midges thrive on
 * organic matter, mosquitoes need still water, fish need room to hunt.
 */
export function carryingCapacity(world: World): Record<SpeciesId, number> {
  const s = world.stream;
  let goodForMayfly = 0;
  for (const i of world.channel) {
    const x = i % world.width;
    const y = (i / world.width) | 0;
    if (shortfall('mayfly', 0.2, localConditions(world, x, y)).stress < 0.05) goodForMayfly++;
  }
  const n = world.channel.length || 1;
  return {
    mayfly: SPECIES.mayfly.cap * (goodForMayfly / n),
    midge: 22 + 28 * Math.min(1, (s.nutrients + s.organicLoad) / 70),
    mosquito: 4 + (SPECIES.mosquito.cap - 4) * Math.min(1, stillWater(world) * 1.6),
    fish: SPECIES.fish.cap,
  };
}

/** How much of the channel is still and warm enough for mosquito eggs, 0 to 1. */
export function stillWater(world: World): number {
  let score = 0;
  for (const i of world.channel) {
    const c = localConditions(world, i % world.width, (i / world.width) | 0);
    if (c.waterTemp < 15) continue;
    score += Math.max(0, Math.min(1, (24 - c.flow) / 16));
  }
  return world.channel.length ? score / world.channel.length : 0;
}

export function countSpecies(world: World): Record<SpeciesId, number> {
  const counts = { mayfly: 0, midge: 0, mosquito: 0, fish: 0 } as Record<SpeciesId, number>;
  for (const o of world.organisms) counts[o.species]++;
  return counts;
}

function cheb(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function isRefuge(world: World, x: number, y: number): boolean {
  return world.terrain[y * world.width + x] === TERRAIN.refuge;
}

function canMate(world: World, o: Organism, counts: Record<SpeciesId, number>): boolean {
  const r = SPECIES[o.species];
  // Mosquito larvae do not breed; adults lay eggs (see immigrate).
  if (o.species === 'mosquito') return false;
  if (o.age < r.maturityTicks || o.mateCooldown > 0 || o.energy < r.mateEnergy) return false;
  if (counts[o.species] >= r.cap || world.organisms.length >= MAX_ORGANISMS) return false;
  return o.stress < 0.1;
}

/** Builds what one animal can sense. */
function observe(world: World, o: Organism, counts: Record<SpeciesId, number>, fish: Organism[]): Observation {
  const r = SPECIES[o.species];
  const { width } = world;
  const here = localConditions(world, o.x, o.y);
  const vision = r.vision;

  let threat: Observation['threat'] = null;
  let prey: Observation['prey'] = null;
  if (o.species !== 'fish') {
    for (const f of fish) {
      const d = cheb(o.x, o.y, f.x, f.y);
      if (d <= vision && (!threat || d < threat.dist)) threat = { x: f.x, y: f.y, dist: d };
    }
  } else {
    for (const p of world.organisms) {
      if (p.species === 'fish' || p.energy <= 0) continue;
      const d = cheb(o.x, o.y, p.x, p.y);
      if (d > vision || isRefuge(world, p.x, p.y)) continue;
      if (!prey || d < prey.dist) prey = { x: p.x, y: p.y, dist: d, id: p.id };
    }
  }

  let refuge: Observation['refuge'] = null;
  let food: Observation['food'] = null;
  let bestFood = -Infinity;
  for (let oy = -vision; oy <= vision; oy++) {
    for (let ox = -vision; ox <= vision; ox++) {
      const x = o.x + ox;
      const y = o.y + oy;
      if (!walkable(world, x, y)) continue;
      const i = y * width + x;
      const d = Math.max(Math.abs(ox), Math.abs(oy));
      if (world.terrain[i] === TERRAIN.refuge && d <= 5 && (!refuge || d < refuge.dist)) refuge = { x, y, dist: d };
      if (o.species === 'fish') continue;
      const algae = world.algae[i];
      let score: number;
      if (o.species === 'mosquito') {
        const lf = world.stream.flow * world.flowFactor[i];
        if (lf > 25) continue;
        score = (30 - lf) / 30 + algae - 0.04 * d;
      } else if (o.species === 'midge') {
        score = algae + 0.1 - 0.02 * d;
      } else {
        if (algae < 0.05) continue;
        score = algae - 0.02 * d;
      }
      if (score > bestFood) {
        bestFood = score;
        food = { x, y, dist: d, amount: algae };
      }
    }
  }

  let mate: Observation['mate'] = null;
  const selfCanMate = canMate(world, o, counts);
  if (selfCanMate) {
    for (const p of world.organisms) {
      if (p === o || p.species !== o.species || p.energy <= 0) continue;
      const d = cheb(o.x, o.y, p.x, p.y);
      if (d > vision + 2) continue;
      if (!canMate(world, p, counts)) continue;
      if (!mate || d < mate.dist) mate = { x: p.x, y: p.y, dist: d, id: p.id };
    }
  }

  let betterWater: Observation['betterWater'] = null;
  const strongFlow = o.species !== 'fish' && here.flow > 70;
  if (o.stress > 0.05 || strongFlow) {
    const current = o.stress + (strongFlow ? here.flow / 200 : 0);
    let best = current;
    for (let oy = -5; oy <= 5; oy += 1) {
      for (let ox = -5; ox <= 5; ox += 2) {
        const x = o.x + ox;
        const y = o.y + oy;
        if (!walkable(world, x, y)) continue;
        const c = localConditions(world, x, y);
        const s = shortfall(o.species, o.tolerance, c).stress + (strongFlow ? c.flow / 200 : 0);
        if (s < best - 0.03) {
          best = s;
          betterWater = { x, y, gain: current - s };
        }
      }
    }
  }

  const wander = pickWander(world, o);
  const candidates: ActionKind[] =
    o.species === 'fish'
      ? ['explore', 'rest', 'hunt', 'mate', 'seekWater']
      : o.species === 'mosquito'
        ? ['explore', 'rest', 'forage', 'flee', 'hide', 'seekWater']
        : ['explore', 'rest', 'forage', 'flee', 'hide', 'mate', 'seekWater'];

  return {
    species: o.species,
    x: o.x,
    y: o.y,
    energy: o.energy,
    canMate: selfCanMate,
    stress: o.stress,
    stressReason: o.stressReason,
    onRefuge: isRefuge(world, o.x, o.y),
    localFlow: here.flow,
    threat,
    refuge,
    food,
    mate,
    prey,
    betterWater,
    wander,
    candidates,
  };
}

function pickWander(world: World, o: Organism): { x: number; y: number } {
  const range = o.species === 'fish' ? 8 : 4;
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = o.x + randInt(world.rng, -range, range);
    const y = o.y + randInt(world.rng, -range, range);
    if (walkable(world, x, y)) return { x, y };
  }
  return { x: o.x, y: o.y };
}

/** One step away from a point, through channel tiles. */
function stepAway(world: World, o: Organism, fx: number, fy: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = (o.x - fx) ** 2 + (o.y - fy) ** 2;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const x = o.x + ox;
      const y = o.y + oy;
      if (!walkable(world, x, y)) continue;
      const d = (x - fx) ** 2 + (y - fy) ** 2;
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  return best;
}

function free(world: World, x: number, y: number, occupied: Set<number>): boolean {
  return walkable(world, x, y) && !occupied.has(y * world.width + x);
}

/** A free channel tile next to (x, y) for a newborn. */
function nurserySpot(world: World, x: number, y: number, occupied: Set<number>): [number, number] {
  const order = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  const start = randInt(world.rng, 0, order.length - 1);
  for (let k = 0; k < order.length; k++) {
    const [ox, oy] = order[(start + k) % order.length];
    if (free(world, x + ox, y + oy, occupied)) return [x + ox, y + oy];
  }
  return [x, y];
}

function eat(world: World, o: Organism): void {
  const r = SPECIES[o.species];
  const i = o.y * world.width + o.x;
  const s = world.stream;
  let gain = 0;
  if (o.species === 'mosquito') {
    const lf = s.flow * world.flowFactor[i];
    if (lf <= r.maxFlow) {
      const take = Math.min(world.algae[i], r.bite * 0.5);
      world.algae[i] -= take;
      gain = 0.12 + take * r.energyPerAlgae + s.organicLoad / 200 + s.nutrients / 400;
    }
  } else {
    const take = Math.min(world.algae[i], r.bite);
    world.algae[i] -= take;
    gain = take * r.energyPerAlgae;
    if (o.species === 'midge') gain += 0.08 + s.organicLoad / 160 + s.nutrients / 320;
  }
  o.energy = Math.min(100, o.energy + gain);
}

export interface StepResult {
  births: number;
  deaths: number;
}

/** Advances the whole world by one tick. */
export function stepWorld(world: World): StepResult {
  world.tick++;
  advanceStream(world);

  if (world.tick % TICKS_PER_SECOND === 0 && growTrees(world)) {
    refreshShade(world);
    world.terrainVersion++;
  }

  const counts = countSpecies(world);
  const capacity = carryingCapacity(world);
  const fish = world.organisms.filter((o) => o.species === 'fish');
  const byId = new Map<number, Organism>();
  const occupied = new Set<number>();
  for (const o of world.organisms) {
    byId.set(o.id, o);
    occupied.add(o.y * world.width + o.x);
  }
  const dead = new Map<number, DeathCause>();
  const emerged = new Set<number>();
  const gone = (id: number) => dead.has(id) || emerged.has(id);
  const newborns: Array<{ species: SpeciesId; x: number; y: number; tolerance: number; generation: number }> = [];

  for (const o of world.organisms) {
    if (gone(o.id)) continue;
    const r = SPECIES[o.species];
    o.age++;
    if (o.mateCooldown > 0) o.mateCooldown--;

    const here = localConditions(world, o.x, o.y);
    const need = shortfall(o.species, o.tolerance, here);
    o.stress = need.stress;
    o.stressReason = need.reason;

    // Decide.
    o.decideTimer--;
    const reached = o.x === o.targetX && o.y === o.targetY;
    if (o.decideTimer <= 0 || (reached && (o.action === 'explore' || o.action === 'seekWater'))) {
      const d = decide(observe(world, o, counts, fish));
      o.action = d.action;
      o.targetId = d.targetId;
      if (d.target) {
        o.targetX = d.target.x;
        o.targetY = d.target.y;
      } else {
        o.targetX = o.x;
        o.targetY = o.y;
      }
      o.decideTimer = r.decideEvery;
    }

    // Move.
    o.moveTimer--;
    o.px = o.x;
    o.py = o.y;
    if (o.moveTimer <= 0) {
      o.moveTimer = r.moveEvery;
      let step: [number, number] | null = null;
      if (o.action === 'flee') {
        step = stepAway(world, o, o.targetX, o.targetY);
      } else if (o.action !== 'rest') {
        if ((o.action === 'hunt' || o.action === 'mate') && o.targetId >= 0) {
          const t = byId.get(o.targetId);
          if (t && !gone(t.id)) {
            o.targetX = t.x;
            o.targetY = t.y;
          } else {
            o.decideTimer = 0;
          }
        }
        if (!(o.action === 'hunt' && cheb(o.x, o.y, o.targetX, o.targetY) <= 1) && !(o.action === 'mate' && cheb(o.x, o.y, o.targetX, o.targetY) <= 1)) {
          step = findRoute(world, o.x, o.y, o.targetX, o.targetY);
        }
      }
      if (step && !(o.species !== 'fish' && occupied.has(step[1] * world.width + step[0]) && o.action !== 'flee')) {
        occupied.delete(o.y * world.width + o.x);
        moveTo(o, step[0], step[1]);
        occupied.add(o.y * world.width + o.x);
      }
    }

    // Feed.
    if (o.species !== 'fish' && (o.action === 'forage' || o.action === 'rest' || o.action === 'hide')) {
      if (o.action === 'forage' || o.energy < 50) eat(world, o);
    }

    // Hunt.
    if (o.species === 'fish' && o.action === 'hunt' && o.targetId >= 0) {
      const p = byId.get(o.targetId);
      if (p && !gone(p.id) && cheb(o.x, o.y, p.x, p.y) <= 1 && !isRefuge(world, p.x, p.y)) {
        const preyKind = p.species as Exclude<SpeciesId, 'fish'>;
        if (chance(world.rng, CATCH_CHANCE[preyKind] * (1 - 0.5 * o.stress))) {
          dead.set(p.id, 'predation');
          o.energy = Math.min(100, o.energy + PREY_ENERGY[preyKind]);
          o.decideTimer = 0;
          moveTo(o, p.x, p.y);
        }
      }
    }

    // Breed.
    if (o.action === 'mate' && o.targetId >= 0) {
      const p = byId.get(o.targetId);
      if (p && !gone(p.id) && cheb(o.x, o.y, p.x, p.y) <= 1 && canMate(world, o, counts) && canMate(world, p, counts)) {
        const litter = randInt(world.rng, r.litter[0], r.litter[1]);
        let made = 0;
        for (let k = 0; k < litter; k++) {
          if (counts[o.species] + made >= r.cap || world.organisms.length + newborns.length >= MAX_ORGANISMS) break;
          // Breeding success falls as the population nears what the stream can support.
          if (!chance(world.rng, 1 - (counts[o.species] + made) / Math.max(1, capacity[o.species]))) continue;
          const mutation = 0.08 * jitter(world.rng);
          newborns.push({
            species: o.species,
            x: o.x,
            y: o.y,
            tolerance: clamp01((o.tolerance + p.tolerance) / 2 + mutation),
            generation: Math.max(o.generation, p.generation) + 1,
          });
          made++;
        }
        if (made) {
          o.energy -= r.birthCost * made * 0.5;
          p.energy -= r.birthCost * made * 0.5;
          o.mateCooldown = r.mateCooldownTicks;
          p.mateCooldown = r.mateCooldownTicks;
          o.decideTimer = 0;
          p.decideTimer = 0;
          counts[o.species] += made;
        }
      }
    }

    // A flood surge washes exposed invertebrates downstream; stones and the slow edges protect them.
    if (o.species !== 'fish' && world.surge > 0.3 && !isRefuge(world, o.x, o.y)) {
      const i = o.y * world.width + o.x;
      if (chance(world.rng, R.washoutChance * world.surge * world.flowFactor[i])) {
        dead.set(o.id, 'washedOut');
        continue;
      }
    }

    // Energy.
    o.energy -= r.metabolism * (1 + 0.3 * o.tolerance) + r.stressCost * o.stress * (o.stress > 0.02 ? 1 : 0);
    if (o.energy <= 0) {
      dead.set(o.id, o.stress > 0.1 ? 'poorWater' : 'starvation');
      continue;
    }
    if (o.age >= o.maxAge) {
      if (o.species === 'mosquito') {
        // Larvae that finish growing fly off as biting adults.
        world.stream.adultMosquitoes += 1;
        world.stats.emerged++;
        emerged.add(o.id);
      } else {
        dead.set(o.id, 'oldAge');
      }
    }
  }

  let deaths = 0;
  if (dead.size || emerged.size) {
    const survivors: Organism[] = [];
    for (const o of world.organisms) {
      const cause = dead.get(o.id);
      if (cause) {
        world.stats.deaths[o.species][cause]++;
        deaths++;
      } else if (!emerged.has(o.id)) {
        survivors.push(o);
      }
    }
    world.organisms = survivors;
  }

  for (const b of newborns) {
    const [x, y] = nurserySpot(world, b.x, b.y, occupied);
    occupied.add(y * world.width + x);
    spawn(world, b.species, x, y, {
      energy: SPECIES[b.species].birthEnergy,
      age: 0,
      tolerance: b.tolerance,
      generation: b.generation,
    });
    world.stats.births[b.species]++;
  }

  if (world.tick % (R.immigrationEvery * TICKS_PER_SECOND) === 0) immigrate(world, capacity);

  return { births: newborns.length, deaths };
}

/**
 * Animals drift in from upstream when the water there suits them, and adult
 * mosquitoes lay eggs in still, warm water. This is what lets a stream recover.
 */
function immigrate(world: World, capacity: Record<SpeciesId, number>): void {
  const counts = countSpecies(world);
  if (world.organisms.length >= MAX_ORGANISMS) return;
  const entry: number[] = [];
  for (const i of world.channel) if (i % world.width <= 1) entry.push(i);
  if (entry.length) {
    const rules: Array<[SpeciesId, number, number, number]> = [
      ['mayfly', 8, 0.03, 0.45],
      ['midge', 8, 0.08, 0.4],
      ['fish', 3, 0.03, 0.2],
    ];
    for (const [species, below, maxStress, p] of rules) {
      if (counts[species] >= below) continue;
      const i = pick(world.rng, entry);
      const x = i % world.width;
      const y = (i / world.width) | 0;
      const c = localConditions(world, x, y);
      if (shortfall(species, 0.2, c).stress > maxStress) continue;
      if (species === 'fish' && counts.mayfly + counts.midge + counts.mosquito < 10) continue;
      if (!chance(world.rng, p)) continue;
      spawn(world, species, x, y, {
        energy: 75,
        age: Math.round(SPECIES[species].maturityTicks * 0.6),
        tolerance: baseTolerance(world, species),
        generation: 0,
      });
      world.stats.arrivals[species]++;
    }
  }

  // Mosquito eggs: laid by adults, plus a few from the wider neighbourhood.
  const s = world.stream;
  if (counts.mosquito >= SPECIES.mosquito.cap) return;
  const room = Math.max(0, 1 - counts.mosquito / Math.max(1, capacity.mosquito));
  const warmth = Math.max(0, Math.min(1.5, (s.waterTemp - 14) / 8));
  const expected = (1 + 0.25 * s.adultMosquitoes) * stillWater(world) * 8 * warmth * room;
  let eggs = Math.floor(expected);
  if (chance(world.rng, expected - eggs)) eggs++;
  for (let k = 0; k < eggs && counts.mosquito + k < SPECIES.mosquito.cap; k++) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const i = world.channel[Math.floor(nextFloat(world.rng) * world.channel.length)];
      const x = i % world.width;
      const y = (i / world.width) | 0;
      const c = localConditions(world, x, y);
      if (c.flow > 22 || c.waterTemp < 15) continue;
      spawn(world, 'mosquito', x, y, { energy: 55, age: 0, tolerance: baseTolerance(world, 'mosquito'), generation: 0 });
      world.stats.arrivals.mosquito++;
      break;
    }
  }
}

/** Average inherited tolerance per species. */
export function meanTolerance(world: World): Record<SpeciesId, number> {
  const sum = { mayfly: 0, midge: 0, mosquito: 0, fish: 0 } as Record<SpeciesId, number>;
  const n = { mayfly: 0, midge: 0, mosquito: 0, fish: 0 } as Record<SpeciesId, number>;
  for (const o of world.organisms) {
    sum[o.species] += o.tolerance;
    n[o.species]++;
  }
  for (const s of SPECIES_IDS) sum[s] = n[s] ? sum[s] / n[s] : 0;
  return sum;
}
