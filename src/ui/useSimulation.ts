import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryPoint, LogEntry, RunExport } from '../engine/types';
import type { FromWorker, Snapshot, TerrainPayload, ToWorker } from '../worker/protocol';

export interface SimulationHandle {
  /** Latest snapshot, updated a few times a second for React. */
  snapshot: Snapshot | null;
  /** Latest snapshot, updated on every message, for the canvas. */
  snapshotRef: React.MutableRefObject<Snapshot | null>;
  terrainRef: React.MutableRefObject<TerrainPayload | null>;
  /** Time the latest snapshot arrived (performance.now()). */
  receivedAtRef: React.MutableRefObject<number>;
  history: HistoryPoint[];
  log: LogEntry[];
  progress: { done: number; total: number } | null;
  error: string | null;
  send: (msg: ToWorker) => void;
  exportRun: () => Promise<RunExport>;
}

const UI_INTERVAL_MS = 200;

export function useSimulation(): SimulationHandle {
  const workerRef = useRef<Worker | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const terrainRef = useRef<TerrainPayload | null>(null);
  const receivedAtRef = useRef(0);
  const exportWaiters = useRef<Array<(d: RunExport) => void>>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastUi = useRef(0);
  const pendingUi = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      if (msg.type === 'snapshot') {
        const snap = msg.snapshot;
        if (snap.terrain) terrainRef.current = snap.terrain;
        snapshotRef.current = snap;
        receivedAtRef.current = performance.now();
        const now = performance.now();
        // Always push immediately when paused or viewing, otherwise throttle.
        if (!snap.playing || now - lastUi.current > UI_INTERVAL_MS) {
          lastUi.current = now;
          setSnapshot(snap);
        } else if (!pendingUi.current) {
          pendingUi.current = setTimeout(() => {
            pendingUi.current = null;
            lastUi.current = performance.now();
            setSnapshot(snapshotRef.current);
          }, UI_INTERVAL_MS);
        }
      } else if (msg.type === 'data') {
        if (msg.reset) {
          setHistory(msg.history);
          setLog(msg.log);
        } else {
          if (msg.history.length) setHistory((h) => h.concat(msg.history));
          if (msg.log.length) setLog((l) => l.concat(msg.log));
        }
      } else if (msg.type === 'export') {
        const waiters = exportWaiters.current;
        exportWaiters.current = [];
        for (const w of waiters) w(msg.data);
      } else if (msg.type === 'progress') {
        setProgress(msg.done >= msg.total ? null : { done: msg.done, total: msg.total });
      } else if (msg.type === 'error') {
        setError(msg.message);
      }
    };
    worker.onerror = (e) => setError(e.message || 'The simulation stopped unexpectedly.');
    return () => {
      worker.terminate();
      workerRef.current = null;
      if (pendingUi.current) clearTimeout(pendingUi.current);
    };
  }, []);

  const send = useCallback((msg: ToWorker) => {
    workerRef.current?.postMessage(msg);
  }, []);

  const exportRun = useCallback(
    () =>
      new Promise<RunExport>((resolve) => {
        exportWaiters.current.push(resolve);
        workerRef.current?.postMessage({ type: 'export' } satisfies ToWorker);
      }),
    [],
  );

  return { snapshot, snapshotRef, terrainRef, receivedAtRef, history, log, progress, error, send, exportRun };
}
