import type { ActionKind, SpeciesId, StressReason } from './types';

/**
 * Rule-based decisions. A pure function from what an animal can sense to one
 * of the actions it is allowed to take. No network, no randomness: the same
 * observation always gives the same decision, so runs are free and reproducible.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Observation {
  species: SpeciesId;
  x: number;
  y: number;
  energy: number;
  canMate: boolean;
  stress: number;
  stressReason: StressReason;
  onRefuge: boolean;
  localFlow: number;
  /** Nearest fish this animal can see (prey only). */
  threat: (Point & { dist: number }) | null;
  /** Nearest stones or roots to hide in. */
  refuge: (Point & { dist: number }) | null;
  /** Best nearby feeding spot. */
  food: (Point & { dist: number; amount: number }) | null;
  /** Nearest partner ready to breed. */
  mate: (Point & { dist: number; id: number }) | null;
  /** Nearest catchable prey (fish only). */
  prey: (Point & { dist: number; id: number }) | null;
  /** Nearby spot where this animal would be less stressed. */
  betterWater: (Point & { gain: number }) | null;
  /** A nearby channel spot to wander toward. */
  wander: Point;
  /** Actions the engine allows right now. */
  candidates: ActionKind[];
}

export interface Decision {
  action: ActionKind;
  target: Point | null;
  targetId: number;
  /** Plain-language reason shown in the inspector. */
  reason: string;
}

/** Energy below which an animal goes looking for food. */
export const HUNGRY = 70;
export const FISH_HUNGRY = 85;

function allowed(obs: Observation, action: ActionKind): boolean {
  return obs.candidates.includes(action);
}

const STRESS_WORDS: Record<StressReason, string> = {
  none: 'the water',
  oxygen: 'low oxygen',
  temperature: 'warm water',
  cold: 'cold water',
  flow: 'the current',
};

export function decide(obs: Observation): Decision {
  return obs.species === 'fish' ? decideFish(obs) : decidePrey(obs);
}

function decidePrey(obs: Observation): Decision {
  // 1. A fish is close: hide if stones are near, otherwise swim away.
  if (obs.threat && obs.threat.dist <= 4) {
    if (obs.onRefuge && allowed(obs, 'rest')) {
      return { action: 'rest', target: null, targetId: -1, reason: 'A fish is nearby, so it is staying hidden among the stones.' };
    }
    if (obs.refuge && obs.refuge.dist <= 3 && allowed(obs, 'hide')) {
      return { action: 'hide', target: obs.refuge, targetId: -1, reason: 'A fish is nearby, so it is heading for the stones to hide.' };
    }
    if (allowed(obs, 'flee')) {
      return { action: 'flee', target: obs.threat, targetId: -1, reason: 'A fish is nearby, so it is swimming away.' };
    }
  }
  // 2. A strong current: shelter behind stones or move to the slow edge.
  if (obs.localFlow > 70 && !obs.onRefuge) {
    if (obs.refuge && obs.refuge.dist <= 2 && allowed(obs, 'hide')) {
      return { action: 'hide', target: obs.refuge, targetId: -1, reason: 'The current is strong, so it is sheltering behind stones.' };
    }
    if (obs.betterWater && allowed(obs, 'seekWater')) {
      return { action: 'seekWater', target: obs.betterWater, targetId: -1, reason: 'The current is strong, so it is moving to slower water.' };
    }
  }
  // 3. Uncomfortable water: move somewhere better if it can find it.
  if (obs.stress > 0.12 && obs.betterWater && allowed(obs, 'seekWater')) {
    return {
      action: 'seekWater',
      target: obs.betterWater,
      targetId: -1,
      reason: `It is struggling with ${STRESS_WORDS[obs.stressReason]}, so it is looking for better water.`,
    };
  }
  // 4. Hungry: feed.
  if (obs.energy < HUNGRY && obs.food && allowed(obs, 'forage')) {
    return { action: 'forage', target: obs.food, targetId: -1, reason: 'It is hungry, so it is feeding.' };
  }
  // 5. Ready to breed.
  if (obs.canMate && obs.mate && allowed(obs, 'mate')) {
    return { action: 'mate', target: obs.mate, targetId: obs.mate.id, reason: 'It is well fed, so it is looking for a mate.' };
  }
  // 6. Otherwise explore.
  if (allowed(obs, 'explore')) {
    return { action: 'explore', target: obs.wander, targetId: -1, reason: 'It is exploring the stream bed.' };
  }
  return { action: 'rest', target: null, targetId: -1, reason: 'It is resting.' };
}

function decideFish(obs: Observation): Decision {
  if (obs.stress > 0.15 && obs.betterWater && allowed(obs, 'seekWater')) {
    return {
      action: 'seekWater',
      target: obs.betterWater,
      targetId: -1,
      reason: `It is struggling with ${STRESS_WORDS[obs.stressReason]}, so it is looking for cooler, better water.`,
    };
  }
  if (obs.energy < FISH_HUNGRY && obs.prey && allowed(obs, 'hunt')) {
    return { action: 'hunt', target: obs.prey, targetId: obs.prey.id, reason: 'It is hungry, so it is hunting insect larvae.' };
  }
  if (obs.canMate && obs.mate && allowed(obs, 'mate')) {
    return { action: 'mate', target: obs.mate, targetId: obs.mate.id, reason: 'It is well fed, so it is looking for a mate.' };
  }
  if (allowed(obs, 'explore')) {
    return { action: 'explore', target: obs.wander, targetId: -1, reason: 'It is patrolling the stream.' };
  }
  return { action: 'rest', target: null, targetId: -1, reason: 'It is resting.' };
}
