import { SECONDS_PER_DAY, STRESSORS } from '../engine/constants';
import type { StressorKind } from '../engine/types';
import type { Snapshot } from '../worker/protocol';
import { StressorIcon } from './icons';

const ORDER: StressorKind[] = ['heatwave', 'drought', 'storm', 'sewage', 'clearTrees', 'plantTrees'];

const SHORT: Record<StressorKind, string> = {
  heatwave: '+10 °C air for 12 days',
  drought: 'Flow drops for 12 days',
  storm: 'Flood surge, germs, nutrients',
  sewage: 'Leak at the drain for 9 days',
  clearTrees: 'Cut trees beside the water',
  plantTrees: 'Saplings grow in about a minute',
};

export function StressorBar({
  snapshot,
  onApply,
  disabled,
}: {
  snapshot: Snapshot | null;
  onApply: (kind: StressorKind) => void;
  disabled: boolean;
}) {
  const effects = snapshot?.effects ?? [];
  return (
    <section className="stressors" aria-labelledby="stressors-title">
      <div className="section-head">
        <h2 id="stressors-title">Stress your stream</h2>
        <p className="muted small">{disabled ? 'Go back to live to apply a stressor.' : 'Apply one, then watch the gauges and the narrator.'}</p>
      </div>
      <div className="stressor-grid">
        {ORDER.map((kind) => {
          const rules = STRESSORS[kind];
          const active = effects.find((e) => e.kind === kind);
          const positive = kind === 'plantTrees';
          return (
            <button
              key={kind}
              className={`stressor ${positive ? 'positive' : ''} ${active ? 'active' : ''}`}
              disabled={disabled}
              onClick={() => onApply(kind)}
              aria-describedby={`stressor-${kind}-desc`}
            >
              <StressorIcon kind={kind} size={30} />
              <span className="stressor-text">
                <span className="stressor-label">{rules.label}</span>
                <span className="stressor-short" id={`stressor-${kind}-desc`}>
                  {active ? `Active · ${Math.ceil(active.remaining / SECONDS_PER_DAY)} days left` : SHORT[kind]}
                </span>
              </span>
              {active && active.duration > 0 && (
                <span className="stressor-progress" aria-hidden="true">
                  <span style={{ width: `${(active.remaining / active.duration) * 100}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
