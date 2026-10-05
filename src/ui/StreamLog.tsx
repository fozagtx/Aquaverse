import { useMemo, useState } from 'react';
import type { LogEntry, LogKind } from '../engine/types';
import { dayLabel } from './format';
import { StressorIcon } from './icons';

const FILTERS: Array<{ id: 'all' | LogKind; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'stressor', label: 'Stressors' },
  { id: 'narration', label: 'Explanations' },
  { id: 'species', label: 'Species' },
  { id: 'edit', label: 'Map edits' },
];

const KIND_LABEL: Record<LogKind, string> = {
  stressor: 'Stressor',
  narration: 'Explanation',
  species: 'Species',
  info: 'Note',
  edit: 'Map edit',
};

export function StreamLog({ log }: { log: LogEntry[] }) {
  const [filter, setFilter] = useState<'all' | LogKind>('all');
  const entries = useMemo(() => [...log].reverse().filter((l) => filter === 'all' || l.kind === filter), [log, filter]);
  return (
    <div className="log-page">
      <header className="page-head">
        <h1>Stream log</h1>
        <p className="lede">Everything that happened, newest first. Explanations are built only from what the simulation did.</p>
      </header>
      <div className="seg filter-row" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <p className="muted card">Nothing yet. Apply a stressor in the Stream view and come back.</p>
      ) : (
        <ol className="log">
          {entries.map((e) => (
            <li key={e.id} className={`log-entry kind-${e.kind}`}>
              <span className="log-time">{dayLabel(e.tick)}</span>
              <span className="log-kind">
                {e.kind === 'stressor' && e.stressor ? <StressorIcon kind={e.stressor} size={16} /> : null} {KIND_LABEL[e.kind]}
              </span>
              <p className="log-text">{e.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
