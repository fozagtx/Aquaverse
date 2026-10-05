import { SPECIES } from './constants';
import type { LocalConditions } from './stream';
import type { SpeciesId, StressReason } from './types';

export interface Shortfall {
  stress: number;
  reason: StressReason;
}

/**
 * How far the local water is outside what a species needs, 0 (fine) to 1
 * (far outside). Inherited tolerance lowers the needs a little.
 */
export function shortfall(species: SpeciesId, tolerance: number, c: LocalConditions): Shortfall {
  const r = SPECIES[species];
  let stress = 0;
  let reason: StressReason = 'none';

  if (r.minOxygen > 0) {
    const need = r.minOxygen * (1 - 0.3 * tolerance);
    const s = (need - c.oxygen) / Math.max(20, need);
    if (s > stress) {
      stress = s;
      reason = 'oxygen';
    }
  }
  const maxTemp = r.maxTemp + 3 * tolerance;
  const hot = (c.waterTemp - maxTemp) / 8;
  if (hot > stress) {
    stress = hot;
    reason = 'temperature';
  }
  if (r.minTemp > -50) {
    const cold = (r.minTemp - c.waterTemp) / 8;
    if (cold > stress) {
      stress = cold;
      reason = 'cold';
    }
  }
  const fast = (c.flow - r.maxFlow) / 40;
  if (fast > stress) {
    stress = fast;
    reason = 'flow';
  }
  return { stress: Math.max(0, Math.min(1, stress)), reason: stress > 0 ? reason : 'none' };
}
