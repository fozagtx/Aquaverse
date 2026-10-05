import { describe, expect, it } from 'vitest';
import { decide, type Observation } from '../src/engine/policy';
import { parseRunExport, SimulationRuntime } from '../src/engine/runtime';
import { buildProfile, describeProfile, SAMPLE_ANSWERS, UNSURE_ANSWERS } from '../src/engine/streamProfile';
import { spawn } from '../src/engine/simulation';
import type { StreamAnswers, World } from '../src/engine/types';
import { runSeconds, runtime } from './helpers';

function fingerprint(w: World): string {
  const orgs = w.organisms.map((o) => `${o.id}:${o.species}:${o.x},${o.y}:${o.energy.toFixed(6)}`).join('|');
  const s = w.stream;
  return `${w.tick}|${s.oxygen.toFixed(8)}|${s.waterTemp.toFixed(8)}|${s.nutrients.toFixed(8)}|${orgs}`;
}

describe('stream check (P0-9)', () => {
  const polluted: StreamAnswers = { clarity: 'murky', smell: 'sewage', banks: 'concrete', creatures: 'worms', flow: 'still' };

  it('two different sets of answers give visibly different streams and gauges', () => {
    const a = runtime(5, SAMPLE_ANSWERS);
    const b = runtime(5, polluted);
    expect(Buffer.from(a.world.terrain).equals(Buffer.from(b.world.terrain))).toBe(false);
    expect(a.world.stream.shade).toBeGreaterThan(b.world.stream.shade + 0.3);
    expect(a.counts().mayfly).toBeGreaterThan(0);
    expect(b.counts().mayfly).toBe(0);
    expect(a.gauges.ecosystem.value).toBeGreaterThan(b.gauges.ecosystem.value + 25);
    expect(a.gauges.risk.value).toBeLessThan(b.gauges.risk.value);
    expect(a.gauges.biodiversity.value).toBeGreaterThan(b.gauges.biodiversity.value);
  });

  it('uses a middle value for "I\'m not sure" and says so', () => {
    const p = buildProfile(UNSURE_ANSWERS);
    expect(p.notes).toHaveLength(5);
    expect(p.notes[0]).toMatch(/middle value/);
    const clear = buildProfile(SAMPLE_ANSWERS);
    const murky = buildProfile(polluted);
    expect(p.nutrients).toBeGreaterThan(clear.nutrients);
    expect(p.nutrients).toBeLessThan(murky.nutrients);
    expect(describeProfile(clear)).toMatch(/^A stream with /);
  });
});

describe('determinism and replay (P1-1)', () => {
  it('same seed, profile and stressor sequence give the same run', () => {
    const run = () => {
      const rt = runtime(77);
      runSeconds(rt, 5);
      rt.applyStressor('heatwave');
      runSeconds(rt, 12);
      rt.applyStressor('storm');
      runSeconds(rt, 8);
      return rt;
    };
    expect(fingerprint(run().world)).toBe(fingerprint(run().world));
  });

  it('an exported run replays to the identical state', () => {
    const rt = runtime(31);
    runSeconds(rt, 4);
    rt.applyStressor('drought');
    runSeconds(rt, 6);
    rt.applyEdits([{ x: 10, y: 3, brush: 'trees' }]);
    runSeconds(rt, 3);
    rt.applyStressor('plantTrees');
    runSeconds(rt, 5);
    const data = parseRunExport(JSON.parse(JSON.stringify(rt.exportRun())));
    expect(data).not.toBeNull();
    const copy = SimulationRuntime.fromExport(data!);
    while (copy.tick < data!.endTick) copy.step();
    expect(fingerprint(copy.world)).toBe(fingerprint(rt.world));
  });

  it('viewing a past frame shows the stream as it was before a stressor', () => {
    const rt = runtime(12);
    runSeconds(rt, 10);
    const tempBefore = rt.world.stream.waterTemp;
    rt.applyStressor('heatwave');
    runSeconds(rt, 40);
    const ticks = rt.frameTicks();
    const index = ticks.lastIndexOf(100);
    expect(index).toBeGreaterThanOrEqual(0);
    const view = rt.viewAt(index)!;
    expect(view.world.stream.waterTemp).toBeCloseTo(tempBefore, 5);
    expect(rt.world.stream.waterTemp).toBeGreaterThan(tempBefore + 3);
  });

  it('rewinding and resuming continues exactly as the original run did', () => {
    const a = runtime(55);
    runSeconds(a, 6);
    a.applyStressor('sewage');
    runSeconds(a, 10);
    const target = a.frameTicks().indexOf(120);
    expect(target).toBeGreaterThan(0);
    const b = runtime(55);
    runSeconds(b, 6);
    b.applyStressor('sewage');
    runSeconds(b, 10);
    b.rewindTo(target);
    expect(b.tick).toBe(120);
    // The original continued from 120 to 160 without further input; so does the rewound copy.
    while (b.tick < 160) b.step();
    expect(fingerprint(b.world)).toBe(fingerprint(a.world));
    expect(b.log.every((l) => l.tick <= 160)).toBe(true);
  });

  it('rejects malformed run files', () => {
    expect(parseRunExport(null)).toBeNull();
    expect(parseRunExport({ app: 'other' })).toBeNull();
    expect(parseRunExport({ app: 'aquaverse', version: 1, seed: 1, answers: { clarity: 'x' }, script: [], endTick: 0 })).toBeNull();
  });
});

describe('rule-based decisions', () => {
  const base: Observation = {
    species: 'mayfly',
    x: 5,
    y: 5,
    energy: 90,
    canMate: false,
    stress: 0,
    stressReason: 'none',
    onRefuge: false,
    localFlow: 30,
    threat: null,
    refuge: null,
    food: null,
    mate: null,
    prey: null,
    betterWater: null,
    wander: { x: 6, y: 5 },
    candidates: ['explore', 'rest', 'forage', 'flee', 'hide', 'mate', 'seekWater'],
  };

  it('hides from a visible fish when stones are near, otherwise flees', () => {
    expect(decide({ ...base, threat: { x: 7, y: 5, dist: 2 }, refuge: { x: 4, y: 5, dist: 1 } }).action).toBe('hide');
    expect(decide({ ...base, threat: { x: 7, y: 5, dist: 2 } }).action).toBe('flee');
    expect(decide({ ...base, threat: { x: 7, y: 5, dist: 2 }, onRefuge: true }).action).toBe('rest');
  });

  it('forages when hungry, mates when ready, otherwise explores', () => {
    expect(decide({ ...base, energy: 40, food: { x: 6, y: 6, dist: 1, amount: 0.3 } }).action).toBe('forage');
    expect(decide({ ...base, canMate: true, mate: { x: 6, y: 5, dist: 1, id: 9 } }).action).toBe('mate');
    expect(decide(base).action).toBe('explore');
  });

  it('only returns legal actions', () => {
    const d = decide({ ...base, energy: 40, food: { x: 6, y: 6, dist: 1, amount: 0.3 }, candidates: ['explore', 'rest'] });
    expect(['explore', 'rest']).toContain(d.action);
  });

  it('fish hunt when hungry and look for better water when stressed', () => {
    const fish: Observation = { ...base, species: 'fish', candidates: ['explore', 'rest', 'hunt', 'mate', 'seekWater'] };
    expect(decide({ ...fish, energy: 50, prey: { x: 6, y: 5, dist: 1, id: 3 } }).action).toBe('hunt');
    expect(decide({ ...fish, stress: 0.4, stressReason: 'temperature', betterWater: { x: 3, y: 3, gain: 0.2 } }).action).toBe('seekWater');
  });
});

describe('performance', () => {
  it('a tick with 200+ organisms stays well under 50 ms', () => {
    const rt = new SimulationRuntime({ seed: 3, answers: { ...SAMPLE_ANSWERS, flow: 'still' } });
    const w = rt.world;
    const kinds = ['mayfly', 'midge', 'mosquito', 'fish'] as const;
    for (let k = 0; w.organisms.length < 210; k++) {
      const i = w.channel[(k * 7919) % w.channel.length];
      spawn(w, kinds[k % 4], i % w.width, (i / w.width) | 0, { energy: 80, age: 50, tolerance: 0.3, generation: 0 });
    }
    rt.applyStressor('drought');
    expect(w.organisms.length).toBeGreaterThanOrEqual(200);
    let worst = 0;
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      rt.step();
      worst = Math.max(worst, performance.now() - t);
    }
    expect(worst).toBeLessThan(50);
  });
});
