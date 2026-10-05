import type { SpeciesId, StressorKind } from './types';

/**
 * Every number in this file is a starting value chosen so the simulation is
 * readable on screen. None of them comes from field data. The field guide
 * says so next to each rule.
 */

export const WORLD_WIDTH = 64;
export const WORLD_HEIGHT = 44;

/** Engine ticks per simulated second. */
export const TICKS_PER_SECOND = 10;
/** Seconds of simulation shown as one "day" in the interface. */
export const SECONDS_PER_DAY = 5;
/** One tick is this many simulated seconds. */
export const DT = 1 / TICKS_PER_SECOND;

/** Replay frames are captured this often. */
export const FRAME_EVERY_TICKS = 10;
/** History points for the trends view are captured this often. */
export const HISTORY_EVERY_TICKS = 10;
export const MAX_FRAMES = 1800;

export const MAX_ORGANISMS = 230;

export interface SpeciesRules {
  id: SpeciesId;
  label: string;
  plural: string;
  /** What kind of animal it is, in plain words. */
  kind: string;
  role: string;
  indicator: 'sensitive' | 'tolerant' | 'risk' | 'predator';
  /** What its presence tells you about the water. */
  tellsYou: string;
  needsText: string;
  color: string;
  /** Oxygen below this causes stress. */
  minOxygen: number;
  /** Water warmer than this causes stress (°C). */
  maxTemp: number;
  /** Water colder than this causes stress (°C), mosquitoes only. */
  minTemp: number;
  /** Local flow above this causes stress. */
  maxFlow: number;
  /** Ticks between steps. */
  moveEvery: number;
  /** Ticks between decisions. */
  decideEvery: number;
  vision: number;
  /** Energy lost per tick just by living. */
  metabolism: number;
  /** Extra energy lost per tick at a full (1.0) shortfall against its needs. */
  stressCost: number;
  /** Algae eaten per bite. */
  bite: number;
  /** Energy gained per unit of algae eaten. */
  energyPerAlgae: number;
  maturityTicks: number;
  maxAgeTicks: number;
  mateCooldownTicks: number;
  mateEnergy: number;
  litter: [number, number];
  birthEnergy: number;
  /** Energy the parent pays per offspring. */
  birthCost: number;
  cap: number;
}

export const SPECIES: Record<SpeciesId, SpeciesRules> = {
  mayfly: {
    id: 'mayfly',
    label: 'Mayfly nymph',
    plural: 'Mayflies',
    kind: 'The young water stage of the mayfly, an insect that lives under stones for months before flying.',
    role: 'Grazes the thin layer of algae on stones.',
    indicator: 'sensitive',
    tellsYou: 'Sensitive. Mayflies need cool water rich in oxygen, so finding them is a sign of clean water.',
    needsText: 'Oxygen above 60, water cooler than 21 °C.',
    color: '#f2c14e',
    minOxygen: 60,
    maxTemp: 21,
    minTemp: -99,
    maxFlow: 140,
    moveEvery: 4,
    decideEvery: 8,
    vision: 5,
    metabolism: 0.05,
    stressCost: 0.9,
    bite: 0.03,
    energyPerAlgae: 260,
    maturityTicks: 180,
    maxAgeTicks: 1500,
    mateCooldownTicks: 220,
    mateEnergy: 55,
    litter: [2, 3],
    birthEnergy: 45,
    birthCost: 12,
    cap: 48,
  },
  midge: {
    id: 'midge',
    label: 'Midge larva',
    plural: 'Midges',
    kind: 'A small worm-like larva of a non-biting midge. Red ones are called bloodworms.',
    role: 'Eats algae and the fine sediment on the stream bed.',
    indicator: 'tolerant',
    tellsYou: 'Tolerant. Midges survive in poor water, so a stream with only midges is a stream under stress.',
    needsText: 'Oxygen above 20. Copes with warm and dirty water.',
    color: '#e5484d',
    minOxygen: 20,
    maxTemp: 30,
    minTemp: -99,
    maxFlow: 140,
    moveEvery: 5,
    decideEvery: 9,
    vision: 4,
    metabolism: 0.05,
    stressCost: 0.8,
    bite: 0.025,
    energyPerAlgae: 230,
    maturityTicks: 160,
    maxAgeTicks: 1400,
    mateCooldownTicks: 220,
    mateEnergy: 55,
    litter: [2, 3],
    birthEnergy: 45,
    birthCost: 12,
    cap: 55,
  },
  mosquito: {
    id: 'mosquito',
    label: 'Mosquito larva',
    plural: 'Mosquitoes',
    kind: 'The water stage of a mosquito. It hangs at the surface and breathes air through a tube.',
    role: 'Filters tiny food particles at the surface of still water.',
    indicator: 'risk',
    tellsYou: 'Risk signal. Mosquito larvae thrive in still, warm water where fish are missing. The adults bite people.',
    needsText: 'Still water (flow below 30) and warmth. Breathes air, so it ignores oxygen.',
    color: '#a78bfa',
    minOxygen: -1,
    maxTemp: 36,
    minTemp: 14,
    maxFlow: 30,
    moveEvery: 6,
    decideEvery: 10,
    vision: 4,
    metabolism: 0.05,
    stressCost: 0.9,
    bite: 0.02,
    energyPerAlgae: 260,
    maturityTicks: 120,
    maxAgeTicks: 900,
    mateCooldownTicks: 200,
    mateEnergy: 50,
    litter: [2, 4],
    birthEnergy: 40,
    birthCost: 10,
    cap: 60,
  },
  fish: {
    id: 'fish',
    label: 'Fish',
    plural: 'Fish',
    kind: 'A small stream fish such as a minnow or young trout.',
    role: 'Hunts insect larvae, including mosquito larvae.',
    indicator: 'predator',
    tellsYou: 'Fish keep mosquito larvae in check. When fish are lost, mosquitoes are released.',
    needsText: 'Oxygen above 40, water cooler than 26 °C.',
    color: '#7cc4f0',
    minOxygen: 40,
    maxTemp: 26,
    minTemp: -99,
    maxFlow: 160,
    moveEvery: 2,
    decideEvery: 5,
    vision: 6,
    metabolism: 0.045,
    stressCost: 0.7,
    bite: 0,
    energyPerAlgae: 0,
    maturityTicks: 500,
    maxAgeTicks: 5000,
    mateCooldownTicks: 600,
    mateEnergy: 75,
    litter: [1, 2],
    birthEnergy: 55,
    birthCost: 25,
    cap: 14,
  },
};

/** Energy a fish gains from each kind of prey. */
export const PREY_ENERGY: Record<Exclude<SpeciesId, 'fish'>, number> = {
  mayfly: 24,
  midge: 20,
  mosquito: 16,
};

/** Chance per tick that a fish next to its prey catches it. */
export const CATCH_CHANCE: Record<Exclude<SpeciesId, 'fish'>, number> = {
  mayfly: 0.12,
  midge: 0.16,
  mosquito: 0.3,
};

export const STREAM_RULES = {
  /** Water temperature: airTemp - shadeCooling * shade - flowCooling * flow/100 + lowWaterWarming. */
  shadeCooling: 5,
  flowCooling: 2,
  lowWaterWarming: 3,
  /** Per second, how fast water temperature follows its target. */
  tempRate: 0.06,
  /** Oxygen target: 100 - tempLoss*(waterTemp-15) - organicUse*organicLoad - bloomPenalty + flowGain*(flow-50). */
  oxygenBase: 100,
  oxygenTempLoss: 3,
  oxygenOrganicUse: 0.45,
  oxygenBloomPenalty: 40,
  oxygenFlowGain: 0.1,
  oxygenRate: 0.18,
  /** Oxygen lost next to the drain at a full plume. */
  plumeOxygenLoss: 55,
  /** Per second, how fast nutrients, germs and organic matter settle back. */
  nutrientRate: 0.012,
  pathogenRate: 0.04,
  organicRate: 0.035,
  turbidityRate: 0.08,
  /** Algae logistic rate per second, and die-off rate when above capacity. */
  algaeGrowth: 0.12,
  algaeDieOff: 0.03,
  /** Shade cuts algae light by up to this share. */
  algaeShadeCut: 0.55,
  /** Algae that dies adds this much organic matter (per unit, per tile, scaled by channel size). */
  algaeDecayToOrganic: 120,
  /** Mean algae above this starts to count as a bloom. */
  bloomStart: 0.4,
  bloomFull: 0.7,
  /** Local flow above this scours algae off the stones. */
  scourFlow: 75,
  /** Chance per tick, at a full flood surge, that an exposed invertebrate is washed away. */
  washoutChance: 0.012,
  /** Adult mosquitoes fly off after this many seconds on average. */
  adultLifetime: 25,
  /** Seconds between chances for animals to drift in from upstream. */
  immigrationEvery: 4,
};

export interface StressorRules {
  kind: StressorKind;
  label: string;
  verb: string;
  /** Seconds the stressor lasts, 0 if instant. */
  duration: number;
  summary: string;
  chain: string;
  icon: string;
}

export const STRESSORS: Record<StressorKind, StressorRules> = {
  heatwave: {
    kind: 'heatwave',
    label: 'Heatwave',
    verb: 'Start a heatwave',
    duration: 60,
    summary: 'Air temperature rises by 10 °C for 60 seconds (12 days).',
    chain: 'Warmer water holds less oxygen. Mayflies decline and fish are stressed.',
    icon: 'sun',
  },
  drought: {
    kind: 'drought',
    label: 'Drought',
    verb: 'Start a drought',
    duration: 60,
    summary: 'Flow drops to a quarter for 60 seconds (12 days).',
    chain: 'Still pools form and warm up. Mosquito larvae breed.',
    icon: 'drop',
  },
  storm: {
    kind: 'storm',
    label: 'Storm runoff',
    verb: 'Send storm runoff',
    duration: 8,
    summary: 'Rain washes off the pavement: a flow surge, then extra nutrients and germs from the drain.',
    chain: 'Some invertebrates are washed away, algae surge on the nutrients, then oxygen crashes.',
    icon: 'cloud',
  },
  sewage: {
    kind: 'sewage',
    label: 'Sewage leak',
    verb: 'Leak sewage',
    duration: 45,
    summary: 'Sewage enters at the storm drain for 45 seconds (9 days).',
    chain: 'Germs and nutrients rise and oxygen falls near the drain. Sensitive species vanish there.',
    icon: 'pipe',
  },
  clearTrees: {
    kind: 'clearTrees',
    label: 'Clear bank trees',
    verb: 'Clear the bank trees',
    duration: 0,
    summary: 'Trees beside the channel are cut down. Shade and runoff filtering fall.',
    chain: 'The water warms, algae spread, and sensitive species slowly decline.',
    icon: 'axe',
  },
  plantTrees: {
    kind: 'plantTrees',
    label: 'Plant bank trees',
    verb: 'Plant bank trees',
    duration: 0,
    summary: 'Saplings are planted on open bank beside the channel and grow over about a minute.',
    chain: 'Shade returns, the water cools, and the stream slowly recovers.',
    icon: 'sprout',
  },
};

/** Air temperature added by a heatwave (°C). */
export const HEATWAVE_DELTA = 10;
/** Flow multiplier during a drought. */
export const DROUGHT_FLOW = 0.25;
/** Base summer air temperature (°C). */
export const BASE_AIR_TEMP = 24;
/** Seconds a planted sapling takes to reach full size. */
export const TREE_GROWTH_SECONDS = 60;
