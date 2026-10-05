import { describe, expect, it } from 'vitest';
import { bandOf, computeGauges, gaugeSentence } from '../src/engine/oneHealth';
import { narrate } from '../src/engine/narrator';
import { buildProfile, SAMPLE_ANSWERS } from '../src/engine/streamProfile';
import { initialStream } from '../src/engine/stream';
import { STRESSOR_KINDS, type StressorKind } from '../src/engine/types';
import { runtime, runSeconds, stressTest } from './helpers';

/** Expected direction of each gauge for each stressor: -1 down, +1 up, 0 not asserted. */
const EXPECT: Record<StressorKind, { ecosystem: number; biodiversity: number; risk: number; at: number }> = {
  heatwave: { ecosystem: -1, biodiversity: -1, risk: 1, at: 55 },
  drought: { ecosystem: -1, biodiversity: 0, risk: 1, at: 50 },
  storm: { ecosystem: -1, biodiversity: 0, risk: 1, at: 5 },
  sewage: { ecosystem: -1, biodiversity: 0, risk: 1, at: 40 },
  clearTrees: { ecosystem: -1, biodiversity: 0, risk: 1, at: 50 },
  plantTrees: { ecosystem: 1, biodiversity: 0, risk: 0, at: 60 },
};

describe('One Health gauges (P0-7)', () => {
  for (const kind of STRESSOR_KINDS) {
    it(`move in the expected direction for ${kind} and name their top factor`, () => {
      const { before, series } = stressTest(kind, 60);
      const e = EXPECT[kind];
      const at = series[e.at - 1].gauges;
      for (const id of ['ecosystem', 'biodiversity', 'risk'] as const) {
        const dir = e[id];
        if (dir < 0) expect(at[id].value, id).toBeLessThan(before.gauges[id].value);
        if (dir > 0) expect(at[id].value, id).toBeGreaterThan(before.gauges[id].value);
        expect(at[id].top.phrase.length).toBeGreaterThan(3);
        expect(['low', 'moderate', 'high']).toContain(at[id].band);
      }
    });
  }

  it('describes a gauge in words, never colour alone', () => {
    const rt = runtime(3);
    const sentence = gaugeSentence(rt.gauges.risk);
    expect(sentence).toMatch(/^Human health risk: (low|moderate|high), mainly /);
  });

  it('bands values into low, moderate and high', () => {
    expect(bandOf(0)).toBe('low');
    expect(bandOf(33)).toBe('low');
    expect(bandOf(34)).toBe('moderate');
    expect(bandOf(66)).toBe('moderate');
    expect(bandOf(67)).toBe('high');
  });

  it('names mosquitoes as the main risk when larvae are everywhere', () => {
    const s = initialStream(buildProfile(SAMPLE_ANSWERS));
    const g = computeGauges({ stream: { ...s, shade: 0.8 }, counts: { mayfly: 5, midge: 10, mosquito: 50, fish: 0 } });
    expect(g.risk.top.key).toBe('mosquitoes');
    expect(g.risk.band).not.toBe('low');
  });
});

describe('rule-based narrator (P0-8)', () => {
  const CAUSE: Record<StressorKind, RegExp> = {
    heatwave: /heatwave/i,
    drought: /drought/i,
    storm: /storm runoff/i,
    sewage: /sewage/i,
    clearTrees: /trees were cleared/i,
    plantTrees: /trees were planted/i,
  };

  for (const kind of STRESSOR_KINDS) {
    it(`explains ${kind} with cause, effect and health consequence`, () => {
      const { logs } = stressTest(kind, 60);
      const stressorLog = logs.find((l) => l.kind === 'stressor');
      expect(stressorLog?.text).toBeTruthy();
      const explanations = logs.filter((l) => l.kind === 'narration' && l.facts?.trigger === 'followUp' && l.stressor === kind);
      expect(explanations.length).toBeGreaterThanOrEqual(1);
      for (const e of explanations) {
        expect(e.text).toMatch(CAUSE[kind]);
        expect(e.text).toMatch(/, so |but the water/);
        expect(e.text).toMatch(/health risk for people nearby/);
        // Only facts the simulation produced: the sentence is rebuilt from the stored facts.
        expect(narrate(e.facts!)).toBe(e.text);
      }
    });
  }

  it('matches the example chain when trees are cleared on a sunny day', () => {
    const { logs } = stressTest('clearTrees', 60);
    const last = logs.filter((l) => l.kind === 'narration' && l.facts?.trigger === 'followUp').pop()!;
    expect(last.text).toMatch(/The bank trees were cleared, so the water warmed by [\d.]+ °C/);
  });
});

describe('gauges are part of the replayed state', () => {
  it('can be recomputed for any past moment', () => {
    const rt = runtime(8);
    runSeconds(rt, 10);
    rt.applyStressor('sewage');
    runSeconds(rt, 30);
    const view = rt.viewAt(0);
    expect(view).not.toBeNull();
    expect(view!.gauges.risk.value).toBeLessThan(rt.gauges.risk.value);
  });
});
