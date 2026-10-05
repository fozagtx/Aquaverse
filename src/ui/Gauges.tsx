import type { Gauge, Gauges } from '../engine/types';
import { upperFirst } from './format';

const ORDER = ['ecosystem', 'biodiversity', 'risk'] as const;

const MEANING: Record<(typeof ORDER)[number], string> = {
  ecosystem: 'Can the water support life?',
  biodiversity: 'How varied is the life, and are sensitive species here?',
  risk: 'How might this stream affect people nearby?',
};

function tone(g: Gauge): 'good' | 'mid' | 'bad' {
  const goodHigh = g.id !== 'risk';
  if (g.band === 'moderate') return 'mid';
  return (g.band === 'high') === goodHigh ? 'good' : 'bad';
}

export function OneHealthGauges({
  gauges,
  liveGauges,
  onExplain,
}: {
  gauges: Gauges;
  liveGauges?: Gauges;
  onExplain: () => void;
}) {
  return (
    <section className="card gauges" aria-labelledby="gauges-title">
      <div className="card-head">
        <h2 id="gauges-title">One Health readout</h2>
        <button className="linklike small" onClick={onExplain}>How is this calculated?</button>
      </div>
      {ORDER.map((id) => {
        const g = gauges[id];
        const live = liveGauges?.[id];
        const t = tone(g);
        const mainly = g.top.key === 'none' ? 'nothing in particular' : g.top.phrase;
        return (
          <div key={id} className={`gauge tone-${t}`}>
            <div className="gauge-row">
              <span className="gauge-label">{g.label}</span>
              <span className="gauge-value">
                <span className={`band-word tone-${t}`}>{upperFirst(g.band)}</span>
                <span className="gauge-num">{g.value}</span>
              </span>
            </div>
            <div
              className="meter"
              role="meter"
              aria-label={g.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={g.value}
              aria-valuetext={`${g.value}, ${g.band}, mainly ${mainly}`}
            >
              <div className="meter-fill" style={{ width: `${g.value}%` }} />
              <span className="meter-tick" style={{ left: '34%' }} />
              <span className="meter-tick" style={{ left: '67%' }} />
            </div>
            <p className="gauge-why">
              {upperFirst(g.band)}, mainly {mainly}.
              {live && live.value !== g.value ? (
                <span className="compare"> Now: {live.value} ({live.value > g.value ? '+' : ''}{live.value - g.value})</span>
              ) : null}
            </p>
            <p className="sr-only">{MEANING[id]}</p>
          </div>
        );
      })}
      <p className="muted tiny">Illustrative teaching values, not a measurement of a real stream.</p>
    </section>
  );
}
