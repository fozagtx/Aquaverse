import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../engine/types';
import { FRAME_EVERY_TICKS, STRESSORS } from '../engine/constants';
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
  // Round the end up to a whole step so the live position sits at the far right of the track.
  const max = firstTick + Math.max(1, Math.ceil((liveTick - firstTick) / FRAME_EVERY_TICKS)) * FRAME_EVERY_TICKS;
  const span = max - firstTick;
  // While the worker catches up, hold the thumb where the user put it; otherwise the
  // controlled input snaps back to the last snapshot and fast key presses go nowhere.
  const [scrub, setScrub] = useState<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);
  const shownTick = snapshot.live ? liveTick : snapshot.tick;
  const value = scrub ?? (snapshot.live ? max : snapshot.tick);
  const markers = log.filter((l) => l.kind === 'stressor' && l.stressor && l.tick >= firstTick);

  const goLive = () => {
    clearTimeout(settle.current);
    setScrub(null);
    onLive();
  };

  return (
    <div className="timeline">
      <div className="timeline-track">
        <label className="sr-only" htmlFor="timeline-range">Timeline: drag back to see the stream as it was</label>
        <input
          id="timeline-range"
          type="range"
          min={firstTick}
          max={max}
          step={FRAME_EVERY_TICKS}
          value={value}
          onChange={(e) => {
            const t = Number(e.target.value);
            setScrub(t);
            clearTimeout(settle.current);
            settle.current = setTimeout(() => setScrub(null), 400);
            if (t >= liveTick) onLive();
            else onView(t);
          }}
          aria-valuetext={`${dayLabel(shownTick)}${snapshot.live ? ', live' : `, live is ${dayLabel(liveTick)}`}`}
        />
        <div className="timeline-markers" role="group" aria-label="Stressors on the timeline">
          {markers.map((m) => {
            const label = `${STRESSORS[m.stressor!].label}, ${dayLabel(m.tick)}: jump to just before`;
            return (
              <button
                key={m.id}
                className="marker"
                style={{ left: `${((m.tick - firstTick) / span) * 100}%` }}
                title={label}
                aria-label={label}
                onClick={() => {
                  clearTimeout(settle.current);
                  setScrub(null);
                  onView(Math.max(firstTick, m.tick - FRAME_EVERY_TICKS));
                }}
              >
                <StressorIcon kind={m.stressor!} size={14} />
              </button>
            );
          })}
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
              <button className="btn small secondary" onClick={goLive}>Back to live</button>
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
