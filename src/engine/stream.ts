import {
  BASE_AIR_TEMP,
  DROUGHT_FLOW,
  DT,
  HEATWAVE_DELTA,
  STREAM_RULES as R,
  STRESSORS,
  TICKS_PER_SECOND,
} from './constants';
import { clearBankTrees, plantBankTrees } from './terrain';
import type { StreamProfile, StreamState, StressorKind, World } from './types';

export function clamp(v: number, lo = 0, hi = 100): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Starting water state from the stream check profile. */
export function initialStream(profile: StreamProfile): StreamState {
  return {
    airTemp: BASE_AIR_TEMP,
    baseAirTemp: BASE_AIR_TEMP,
    waterTemp: BASE_AIR_TEMP - 3,
    flow: profile.flow,
    baseFlow: profile.flow,
    nutrients: profile.nutrients,
    baseNutrients: profile.nutrients,
    oxygen: 80,
    pathogens: profile.pathogens,
    basePathogens: profile.pathogens,
    organicLoad: profile.organicLoad,
    baseOrganicLoad: profile.organicLoad,
    turbidity: profile.turbidity,
    shade: 0,
    filtering: 0,
    pavement: profile.pavement,
    baseFiltering: 0,
    basePavement: profile.pavement,
    meanAlgae: profile.algae,
    bloom: 0,
    adultMosquitoes: 0,
  };
}

export function effectActive(world: World, kind: StressorKind): boolean {
  return world.effects.some((e) => e.kind === kind && world.tick < e.endTick);
}

export function effectRemaining(world: World, kind: StressorKind): number {
  let best = 0;
  for (const e of world.effects) if (e.kind === kind) best = Math.max(best, e.endTick - world.tick);
  return Math.max(0, best) / TICKS_PER_SECOND;
}

/** How strongly rain runoff reaches the water: more pavement, less filtering = more runoff. */
export function runoffFactor(s: StreamState): number {
  return clamp(0.75 + 0.6 * s.pavement - 0.35 * s.filtering, 0.45, 1.4);
}

/** Water temperature the stream is heading toward. */
export function targetWaterTemp(s: StreamState): number {
  return (
    s.airTemp -
    R.shadeCooling * s.shade -
    R.flowCooling * (s.flow / 100) +
    R.lowWaterWarming * Math.max(0, (30 - s.flow) / 30)
  );
}

/** Oxygen the stream is heading toward. */
export function targetOxygen(s: StreamState): number {
  return clamp(
    R.oxygenBase -
      R.oxygenTempLoss * Math.max(0, s.waterTemp - 15) -
      R.oxygenOrganicUse * s.organicLoad -
      R.oxygenBloomPenalty * s.bloom +
      R.oxygenFlowGain * (s.flow - 50) -
      0.05 * s.turbidity,
  );
}

/**
 * Starts a stressor. Timed stressors are stored as effects; instant ones
 * (clearing or planting trees) change the terrain straight away.
 * Returns a short description of what happened.
 */
export function startStressor(world: World, kind: StressorKind): string {
  const s = world.stream;
  const rules = STRESSORS[kind];
  if (rules.duration > 0) {
    const end = world.tick + Math.round(rules.duration * TICKS_PER_SECOND);
    const existing = world.effects.find((e) => e.kind === kind && world.tick < e.endTick);
    if (existing) existing.endTick = end;
    else world.effects.push({ kind, startTick: world.tick, endTick: end });
  }
  switch (kind) {
    case 'heatwave':
      return `Air temperature rising toward ${Math.round(s.baseAirTemp + HEATWAVE_DELTA)} °C.`;
    case 'drought':
      return `Flow falling toward ${Math.round(s.baseFlow * DROUGHT_FLOW)}.`;
    case 'storm': {
      const rf = runoffFactor(s);
      world.surge = 1;
      s.nutrients = clamp(s.nutrients + 60 * rf);
      s.pathogens = clamp(s.pathogens + 50 * rf);
      s.organicLoad = clamp(s.organicLoad + 18 * rf);
      s.turbidity = clamp(s.turbidity + 50);
      return rf > 0.9
        ? 'Rain is pouring off the pavement straight into the stream.'
        : 'Rain is running off into the stream; the banks soak up some of it.';
    }
    case 'sewage':
      return 'Sewage is leaking from the storm drain.';
    case 'clearTrees': {
      const n = clearBankTrees(world);
      if (!n) return 'There were no bank trees left to clear.';
      return `${n} bank trees were cut down.`;
    }
    case 'plantTrees': {
      const n = plantBankTrees(world);
      return n ? `${n} saplings were planted on the banks.` : 'There was no open bank left to plant.';
    }
  }
}

/** Advances the water state by one tick. Grazing is handled by the simulation. */
export function advanceStream(world: World): void {
  const s = world.stream;
  const heat = effectActive(world, 'heatwave');
  const drought = effectActive(world, 'drought');
  const storm = effectActive(world, 'storm');
  const sewage = effectActive(world, 'sewage');

  // Air temperature.
  const airTarget = s.baseAirTemp + (heat ? HEATWAVE_DELTA : 0);
  s.airTemp += (airTarget - s.airTemp) * Math.min(1, 0.5 * DT);

  // Flow: drought lowers it, a storm surge lifts it, and it relaxes back.
  if (storm) world.surge = Math.min(1, world.surge + 0.5 * DT);
  else world.surge = Math.max(0, world.surge - 0.1 * DT);
  const baseTarget = s.baseFlow * (drought ? DROUGHT_FLOW : 1);
  const flowTarget = baseTarget + world.surge * (105 - baseTarget);
  const flowRate = flowTarget > s.flow ? 0.9 : 0.25;
  s.flow = clamp(s.flow + (flowTarget - s.flow) * Math.min(1, flowRate * DT));

  // Water temperature follows air, shade and flow.
  s.waterTemp += (targetWaterTemp(s) - s.waterTemp) * R.tempRate * DT;

  // Nutrients settle toward a level set by filtering, paving and flushing.
  const flushing = Math.pow(s.baseFlow / Math.max(s.flow, 8), 0.3);
  const nutrientEq =
    (s.baseNutrients + 40 * Math.max(0, s.baseFiltering - s.filtering) + 25 * Math.max(0, s.pavement - s.basePavement)) *
    flushing;
  s.nutrients += R.nutrientRate * (nutrientEq - s.nutrients) * DT;
  s.pathogens += R.pathogenRate * (0.6 + s.flow / 100) * (s.basePathogens - s.pathogens) * DT;
  s.organicLoad += R.organicRate * (s.baseOrganicLoad - s.organicLoad) * DT;
  s.turbidity += R.turbidityRate * (world.profile.turbidity - s.turbidity) * DT;

  if (sewage) {
    s.nutrients += 1.6 * DT;
    s.pathogens += 3.2 * DT;
    s.organicLoad += 1.8 * DT;
  }
  if (storm) s.turbidity += 4 * DT;

  // Algae: grows toward a capacity set by nutrients, light and warmth.
  const nf = Math.min(1.3, s.nutrients / 50);
  const wf = clamp(0.55 + (s.waterTemp - 12) / 16, 0.4, 1.35);
  const tf = 1 - 0.35 * (s.turbidity / 100);
  let total = 0;
  let died = 0;
  let grown = 0;
  const flowNow = s.flow;
  for (const i of world.channel) {
    let a = world.algae[i];
    const lf = 1 - R.algaeShadeCut * world.localShade[i];
    const cap = clamp(0.08 + 0.95 * nf * lf * wf * tf, 0.04, 1);
    if (a < cap) {
      const g = R.algaeGrowth * (cap - a) * DT;
      a += g;
      grown += g;
    } else {
      const d = R.algaeDieOff * (a - cap) * DT;
      a -= d;
      died += d;
    }
    const localFlow = flowNow * world.flowFactor[i];
    if (localFlow > R.scourFlow) {
      const d = a * 0.14 * DT * ((localFlow - R.scourFlow) / 25);
      a -= d;
    }
    world.algae[i] = a < 0 ? 0 : a > 1 ? 1 : a;
    total += world.algae[i];
  }
  const n = world.channel.length || 1;
  s.meanAlgae = total / n;
  s.bloom = clamp((s.meanAlgae - R.bloomStart) / (R.bloomFull - R.bloomStart), 0, 1);
  s.organicLoad = clamp(s.organicLoad + (died / n) * R.algaeDecayToOrganic);
  s.nutrients = clamp(s.nutrients - (grown / n) * 18);
  s.pathogens = clamp(s.pathogens);
  s.organicLoad = clamp(s.organicLoad);
  s.turbidity = clamp(s.turbidity);

  // Oxygen.
  s.oxygen += (targetOxygen(s) - s.oxygen) * Math.min(1, R.oxygenRate * DT);
  s.oxygen = clamp(s.oxygen);

  advancePlume(world, sewage ? 1 : storm ? 0.75 : 0);

  // Adult mosquitoes fly off over time.
  s.adultMosquitoes = Math.max(0, s.adultMosquitoes * (1 - DT / R.adultLifetime));
}

const scratch = { buf: new Float32Array(0) };

/** Pollution enters at the drain and drifts downstream (to the right). */
function advancePlume(world: World, inject: number): void {
  const { width, height, plume, terrain, drain } = world;
  if (scratch.buf.length !== plume.length) scratch.buf = new Float32Array(plume.length);
  const next = scratch.buf;
  next.fill(0);
  const speed = Math.min(0.45, 0.06 + 0.25 * (world.stream.flow / 100));
  let any = inject > 0;
  for (const i of world.channel) {
    const x = i % width;
    const y = (i / width) | 0;
    let up = 0;
    let upN = 0;
    if (x > 0) {
      for (let oy = -1; oy <= 1; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= height) continue;
        const j = ny * width + x - 1;
        if (terrain[j] <= 1) {
          up += plume[j];
          upN++;
        }
      }
    }
    const upstream = upN ? up / upN : 0;
    const p = plume[i] * (1 - speed) + upstream * speed * 0.99;
    next[i] = p * (1 - 0.006);
    if (next[i] > 0.002) any = true;
  }
  if (!any) {
    plume.fill(0);
    return;
  }
  if (inject > 0) {
    for (let i = 0; i < drain.length; i++) {
      if (!drain[i]) continue;
      const x = i % width;
      const y = (i / width) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (terrain[j] <= 1) next[j] = Math.max(next[j], inject);
        }
      }
    }
  }
  for (const i of world.channel) plume[i] = next[i] < 0.002 ? 0 : next[i];
}

/** Conditions an animal feels on one tile. */
export interface LocalConditions {
  oxygen: number;
  waterTemp: number;
  flow: number;
  shade: number;
  algae: number;
  plume: number;
}

export function localConditions(world: World, x: number, y: number): LocalConditions {
  const i = y * world.width + x;
  const s = world.stream;
  const plume = world.plume[i] || 0;
  return {
    oxygen: clamp(s.oxygen - R.plumeOxygenLoss * plume),
    waterTemp: s.waterTemp - 0.8 * world.localShade[i] + 0.5,
    flow: s.flow * (world.flowFactor[i] || 0),
    shade: world.localShade[i] || 0,
    algae: world.algae[i] || 0,
    plume,
  };
}
