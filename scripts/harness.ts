import { SimulationRuntime } from '../src/engine/runtime';
import { SAMPLE_ANSWERS } from '../src/engine/streamProfile';
import type { StreamAnswers, StressorKind } from '../src/engine/types';

const args = process.argv.slice(2);
const stressor = (args[0] as StressorKind | 'none') ?? 'none';
const at = Number(args[1] ?? 30);
const total = Number(args[2] ?? 150);
const seed = Number(args[3] ?? 7);
const answers: StreamAnswers = args[4] ? JSON.parse(args[4]) : SAMPLE_ANSWERS;

const rt = new SimulationRuntime({ seed, answers });
const t0 = performance.now();
let maxTick = 0;
const fmt = (n: number, d = 1) => n.toFixed(d).padStart(6);
console.log('  t | temp  oxy   nutr  path  flow  shade algae |  may  mid  mos fish adult | eco  bio risk');
for (let s = 0; s <= total; s++) {
  if (s === at && stressor !== 'none') {
    const logs = rt.applyStressor(stressor);
    for (const l of logs) console.log('   >>', l.text);
  }
  if (s % 5 === 0) {
    const w = rt.world.stream;
    const c = rt.counts();
    const g = rt.gauges;
    console.log(
      `${String(s).padStart(3)} |${fmt(w.waterTemp)}${fmt(w.oxygen)}${fmt(w.nutrients)}${fmt(w.pathogens)}${fmt(w.flow)}${fmt(w.shade, 2)}${fmt(w.meanAlgae, 2)} | ${String(c.mayfly).padStart(4)} ${String(c.midge).padStart(4)} ${String(c.mosquito).padStart(4)} ${String(c.fish).padStart(4)} ${fmt(w.adultMosquitoes)} | ${String(g.ecosystem.value).padStart(3)} ${String(g.biodiversity.value).padStart(4)} ${String(g.risk.value).padStart(4)}  ${g.risk.top.phrase}`,
    );
  }
  for (let k = 0; k < 10; k++) {
    const a = performance.now();
    const logs = rt.step();
    maxTick = Math.max(maxTick, performance.now() - a);
    for (const l of logs) console.log('   --', `[${(l.tick / 10).toFixed(0)}s ${l.kind}]`, l.text);
  }
}
const st = rt.world.stats;
console.log('births', st.births, 'arrivals', st.arrivals, 'emerged', st.emerged);
console.log('deaths', JSON.stringify(st.deaths));
console.log(`ms total ${(performance.now() - t0).toFixed(0)} max tick ${maxTick.toFixed(2)}ms organisms ${rt.world.organisms.length}`);
