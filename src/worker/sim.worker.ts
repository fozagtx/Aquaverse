/// <reference lib="webworker" />
import { TICKS_PER_SECOND } from '../engine/constants';
import { SimulationRuntime } from '../engine/runtime';
import type { Gauges } from '../engine/types';
import type { FromWorker, ToWorker } from './protocol';
import { buildSnapshot } from './snapshot';

/**
 * Runs the simulation off the main thread. Everything is local: no network,
 * no accounts. The UI sends commands and receives snapshots.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let rt: SimulationRuntime | null = null;
let playing = false;
let speed = 1;
let viewTick: number | null = null;
/** Whether the run was playing when the user started looking at the past. */
let resumeOnLive = false;
let sentTerrainVersion = -1;
let sentHistory = 0;
let sentLog = 0;
let lastTime = 0;
let carry = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function snapshot(): void {
  if (!rt) return;
  let world = rt.world;
  let gauges: Gauges = rt.gauges;
  if (viewTick !== null) {
    const ticks = rt.frameTicks();
    let index = 0;
    for (let i = 0; i < ticks.length; i++) if (ticks[i] <= viewTick) index = i;
    const view = rt.viewAt(index);
    if (view) {
      world = view.world;
      gauges = view.gauges;
    }
  }
  const snap = buildSnapshot({
    world,
    gauges,
    liveGauges: viewTick !== null ? rt.gauges : undefined,
    live: viewTick === null,
    playing,
    speed,
    includeTerrain: world.terrainVersion !== sentTerrainVersion,
    runtime: rt,
  });
  sentTerrainVersion = world.terrainVersion;
  const transfer: Transferable[] = [snap.algae.buffer, snap.plume.buffer, snap.organisms.buffer];
  if (snap.terrain) {
    const t = snap.terrain;
    transfer.push(t.terrain.buffer, t.drain.buffer, t.treeGrowth.buffer, t.flowFactor.buffer, t.localShade.buffer);
  }
  post({ type: 'snapshot', snapshot: snap }, transfer);
}

function sendData(reset = false): void {
  if (!rt) return;
  if (reset) {
    sentHistory = 0;
    sentLog = 0;
  }
  const history = rt.history.slice(sentHistory);
  const log = rt.log.slice(sentLog);
  if (!reset && !history.length && !log.length) return;
  sentHistory = rt.history.length;
  sentLog = rt.log.length;
  post({ type: 'data', reset, history, log });
}

function loop(): void {
  if (!rt || !playing) return;
  const now = performance.now();
  const elapsed = Math.min(500, now - lastTime);
  lastTime = now;
  carry += (elapsed / 1000) * TICKS_PER_SECOND * speed;
  let n = Math.floor(carry);
  carry -= n;
  n = Math.min(n, 60);
  if (!n) return;
  for (let i = 0; i < n; i++) rt.step();
  snapshot();
  sendData();
}

/** Leaves the past for the live run, playing again if it was playing before looking back. */
function leaveView(): void {
  const resume = viewTick !== null && resumeOnLive;
  viewTick = null;
  resumeOnLive = false;
  if (resume) setPlaying(true);
  else snapshot();
}

function setPlaying(on: boolean): void {
  playing = on;
  if (on) {
    viewTick = null;
    lastTime = performance.now();
    carry = 0;
    if (!timer) timer = setInterval(loop, 50);
  } else if (timer) {
    clearInterval(timer);
    timer = null;
  }
  snapshot();
}

ctx.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init': {
        setPlaying(false);
        rt = new SimulationRuntime(msg.config, msg.script ?? []);
        viewTick = null;
        resumeOnLive = false;
        sentTerrainVersion = -1;
        if (msg.endTick && msg.endTick > 0) {
          // Replay an imported run to where it was saved.
          const total = msg.endTick;
          while (rt.tick < total) {
            rt.step();
            if (rt.tick % 200 === 0) post({ type: 'progress', done: rt.tick, total });
          }
          post({ type: 'progress', done: total, total });
        }
        sendData(true);
        snapshot();
        if (msg.play) setPlaying(true);
        break;
      }
      case 'play':
        if (viewTick !== null) viewTick = null;
        setPlaying(true);
        break;
      case 'pause':
        setPlaying(false);
        break;
      case 'speed':
        speed = Math.max(0.5, Math.min(8, msg.speed));
        snapshot();
        break;
      case 'stressor':
        if (!rt) break;
        if (viewTick !== null) viewTick = null;
        rt.applyStressor(msg.kind);
        snapshot();
        sendData();
        break;
      case 'edit':
        if (!rt) break;
        viewTick = null;
        rt.applyEdits(msg.edits);
        snapshot();
        sendData();
        break;
      case 'view':
        if (!rt) break;
        if (msg.tick >= rt.tick) {
          leaveView();
          break;
        }
        if (viewTick === null) resumeOnLive = playing;
        setPlaying(false);
        viewTick = msg.tick;
        snapshot();
        break;
      case 'live':
        leaveView();
        break;
      case 'rewind': {
        if (!rt) break;
        // "Resume from here" carries on from that moment, as it was before looking back.
        const resume = viewTick !== null && resumeOnLive;
        setPlaying(false);
        const ticks = rt.frameTicks();
        let index = 0;
        for (let i = 0; i < ticks.length; i++) if (ticks[i] <= msg.tick) index = i;
        rt.rewindTo(index);
        viewTick = null;
        resumeOnLive = false;
        sendData(true);
        if (resume) setPlaying(true);
        else snapshot();
        break;
      }
      case 'export':
        if (rt) post({ type: 'export', data: rt.exportRun() });
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
