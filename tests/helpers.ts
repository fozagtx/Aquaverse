import { TICKS_PER_SECOND } from '../src/engine/constants';
import { SimulationRuntime } from '../src/engine/runtime';
import { SAMPLE_ANSWERS } from '../src/engine/streamProfile';
import type { LogEntry, StreamAnswers, StressorKind } from '../src/engine/types';

export function runtime(seed = 7, answers: StreamAnswers = SAMPLE_ANSWERS): SimulationRuntime {
  return new SimulationRuntime({ seed, answers });
}

export function runSeconds(rt: SimulationRuntime, seconds: number): LogEntry[] {
  const logs: LogEntry[] = [];
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) logs.push(...rt.step());
  return logs;
}

/** Warms a sample stream up, applies a stressor, and returns before/after snapshots. */
export function stressTest(kind: StressorKind, seconds = 60, seed = 7, answers: StreamAnswers = SAMPLE_ANSWERS) {
  const rt = runtime(seed, answers);
  runSeconds(rt, 20);
  const before = { stream: { ...rt.world.stream }, counts: rt.counts(), gauges: rt.gauges, washed: washed(rt) };
  const logs = rt.applyStressor(kind);
  const series: Array<{ t: number; stream: typeof rt.world.stream; counts: ReturnType<typeof rt.counts>; gauges: typeof rt.gauges }> = [];
  for (let s = 0; s < seconds; s++) {
    logs.push(...runSeconds(rt, 1));
    series.push({ t: s + 1, stream: { ...rt.world.stream }, counts: rt.counts(), gauges: rt.gauges });
  }
  return { rt, before, series, logs, after: series[series.length - 1] };
}

export function washed(rt: SimulationRuntime): number {
  const d = rt.world.stats.deaths;
  return d.mayfly.washedOut + d.midge.washedOut + d.mosquito.washedOut;
}

export const SEEDS = [1, 7, 42, 1234, 99991];
