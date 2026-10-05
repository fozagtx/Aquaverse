import type { LogEntry } from '../engine/types';
import { STRESSORS } from '../engine/constants';
import type { Snapshot } from '../worker/protocol';
import { dayLabel, dayOf } from './format';
import { StressorIcon } from './icons';

/** Pause, scrub back to before a stressor, and compare. */
export function Timeline({
  snapshot,
  log,
  onView,
  onLive,
  onRewind,
}: {
  snapshot: Snapshot;
  log: LogEntry[];
  onView: (tick: number) => void;
  onLive: () => void;
  onRewind: (tick: number) => void;
}) {
  const { firstTick, liveTick } = snapshot.timeline;
  const span = Math.max(1, liveTick - firstTick);
  const value = snapshot.live ? liveTick : snapshot.tick;
  const markers = log.filter((l) => l.kind === 'stressor' && l.stressor && l.tick >= firstTick);

  return (
    <div className="timeline">
      <div className="timeline-track">
        <label className="sr-only" htmlFor="timeline-range">Timeline: drag back to see the stream as it was</label>
        <input
          id="timeline-range"
          type="range"
          min={firstTick}
          max={liveTick}
          step={10}
          value={value}
          onChange={(e) => {
            const t = Number(e.target.value);
            if (t >= liveTick) onLive();
            else onView(t);
          }}
          aria-valuetext={`${dayLabel(value)}${snapshot.live ? ', live' : `, live is ${dayLabel(liveTick)}`}`}
        />
        <div className="timeline-markers" aria-hidden="true">
          {markers.map((m) => (
            <button
              key={m.id}
              className="marker"
              tabIndex={-1}
              style={{ left: `${((m.tick - firstTick) / span) * 100}%` }}
              title={`${STRESSORS[m.stressor!].label}, ${dayLabel(m.tick)}: jump to just before`}
              onClick={() => onView(Math.max(firstTick, m.tick - 10))}
            >
              <StressorIcon kind={m.stressor!} size={14} />
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-info">
        {snapshot.live ? (
          <span className="muted small">
            {markers.length ? 'Drag back, or click a marker, to see the stream before a stressor.' : 'Drag back to rewind once things change.'}
          </span>
        ) : (
          <>
            <span className="viewing" role="status">
              Viewing {dayLabel(snapshot.tick)} · live is {dayLabel(liveTick)} ({dayOf(liveTick) - dayOf(snapshot.tick)} days later)
            </span>
            <span className="row">
              <button className="btn small secondary" onClick={onLive}>Back to live</button>
              <button className="btn small ghost" onClick={() => onRewind(snapshot.tick)} title="Discard everything after this moment and continue from here">
                Resume from here
              </button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
