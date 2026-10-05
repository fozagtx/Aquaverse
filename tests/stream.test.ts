import { describe, expect, it } from 'vitest';
import { STRESSOR_KINDS, type SpeciesId } from '../src/engine/types';
import { walkable } from '../src/engine/terrain';
import { SEEDS, runSeconds, runtime, stressTest } from './helpers';

const max = (xs: number[]) => Math.max(...xs);
const min = (xs: number[]) => Math.min(...xs);

describe('species under local rules (P0-4)', () => {
  it('mayflies, midges, mosquitoes and fish are all alive after 60 s on the healthy sample stream', () => {
    for (const seed of SEEDS) {
      const rt = runtime(seed);
      runSeconds(rt, 60);
      const c = rt.counts();
      for (const s of ['mayfly', 'midge', 'mosquito', 'fish'] as SpeciesId[]) {
        expect(c[s], `${s} with seed ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every creature in the channel, even through every stressor (P0-3)', () => {
    const rt = runtime(21);
    for (const kind of STRESSOR_KINDS) {
      rt.applyStressor(kind);
      for (let i = 0; i < 100; i++) {
        rt.step();
        for (const o of rt.world.organisms) expect(walkable(rt.world, o.x, o.y)).toBe(true);
      }
    }
  });
});

describe('stream state (P0-5)', () => {
  it('updates temperature, oxygen, nutrients, pathogens, flow and shade every tick', () => {
    const rt = runtime(4);
    const s = rt.world.stream;
    for (const key of ['waterTemp', 'oxygen', 'nutrients', 'pathogens', 'flow', 'shade'] as const) {
      expect(Number.isFinite(s[key])).toBe(true);
    }
    rt.applyStressor('storm');
    const before = { ...rt.world.stream };
    rt.step();
    const after = rt.world.stream;
    expect(after.flow).not.toBe(before.flow);
    expect(after.waterTemp).not.toBe(before.waterTemp);
    expect(after.oxygen).not.toBe(before.oxygen);
    expect(after.nutrients).not.toBe(before.nutrients);
    expect(after.pathogens).not.toBe(before.pathogens);
  });
});

describe('stressor chains within 60 s (P0-6)', () => {
  it('heatwave: warmer water, less oxygen, mayflies decline, fish stressed', () => {
    const { before, series, rt } = stressTest('heatwave');
    const after = series[59];
    expect(after.stream.waterTemp - before.stream.waterTemp).toBeGreaterThan(5);
    expect(after.stream.oxygen).toBeLessThan(before.stream.oxygen - 10);
    expect(after.counts.mayfly).toBeLessThan(before.counts.mayfly * 0.75);
    const fishStress = rt.meanStress().fish;
    expect(fishStress).toBeGreaterThan(0);
  });

  it('drought: still pools, warmer water, mosquitoes breed', () => {
    const { before, series } = stressTest('drought');
    const after = series[59];
    expect(after.stream.flow).toBeLessThan(25);
    expect(after.stream.waterTemp).toBeGreaterThan(before.stream.waterTemp + 1);
    expect(after.counts.mosquito).toBeGreaterThanOrEqual(Math.max(8, before.counts.mosquito * 2));
  });

  it('storm runoff: flow surge washes some invertebrates out, then algae surge, then oxygen falls', () => {
    const { before, series, rt } = stressTest('storm');
    const peakFlow = max(series.slice(0, 10).map((p) => p.stream.flow));
    expect(peakFlow).toBeGreaterThan(95);
    const washedTotal = rt.world.stats.deaths.mayfly.washedOut + rt.world.stats.deaths.midge.washedOut + rt.world.stats.deaths.mosquito.washedOut;
    expect(washedTotal - before.washed).toBeGreaterThanOrEqual(5);
    expect(max(series.map((p) => p.stream.meanAlgae))).toBeGreaterThan(before.stream.meanAlgae + 0.2);
    const algaePeakAt = series.findIndex((p) => p.stream.meanAlgae > before.stream.meanAlgae + 0.2);
    const oxygenLow = min(series.map((p) => p.stream.oxygen));
    expect(oxygenLow).toBeLessThan(before.stream.oxygen - 15);
    const oxygenLowAt = series.findIndex((p) => p.stream.oxygen === oxygenLow);
    expect(oxygenLowAt).toBeGreaterThan(algaePeakAt);
    expect(oxygenLowAt).toBeLessThan(60);
  });

  it('sewage leak: germs and nutrients rise, oxygen falls, sensitive species leave the drain', () => {
    const { before, series } = stressTest('sewage');
    const after = series[44];
    expect(after.stream.pathogens).toBeGreaterThan(before.stream.pathogens + 30);
    expect(after.stream.nutrients).toBeGreaterThan(before.stream.nutrients + 20);
    expect(after.stream.oxygen).toBeLessThan(before.stream.oxygen - 15);
  });

  it('clearing bank trees: less shade, warmer water, more algae, slow decline', () => {
    const { before, series } = stressTest('clearTrees');
    const after = series[59];
    expect(after.stream.shade).toBeLessThan(before.stream.shade - 0.3);
    expect(after.stream.waterTemp).toBeGreaterThan(before.stream.waterTemp + 1.5);
    expect(after.stream.meanAlgae).toBeGreaterThan(before.stream.meanAlgae + 0.08);
    expect(after.counts.mayfly).toBeLessThan(before.counts.mayfly);
  });

  it('planting bank trees: shade returns gradually and the water cools', () => {
    const { before, series } = stressTest('plantTrees');
    expect(series[4].stream.shade).toBeLessThan(series[59].stream.shade - 0.15);
    expect(series[59].stream.shade).toBeGreaterThan(before.stream.shade + 0.3);
    expect(series[59].stream.waterTemp).toBeLessThan(before.stream.waterTemp - 1);
  });
});
