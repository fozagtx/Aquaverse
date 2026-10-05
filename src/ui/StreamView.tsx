import { useEffect, useMemo, useState } from 'react';
import { SPECIES } from '../engine/constants';
import { buildProfile, describeProfile } from '../engine/streamProfile';
import { SPECIES_IDS, type RunConfig, type StressorKind } from '../engine/types';
import type { Snapshot } from '../worker/protocol';
import { round1 } from './format';
import { OneHealthGauges } from './Gauges';
import { Inspector } from './Inspector';
import { Narrator } from './Narrator';
import { SPECIES_COLORS } from './sprites';
import { Stage } from './Stage';
import { StressorBar } from './StressorBar';
import { TakeAction } from './TakeAction';
import { Timeline } from './Timeline';
import type { SimulationHandle } from './useSimulation';

function WaterNow({ snap }: { snap: Snapshot }) {
  const s = snap.stream;
  const items: Array<{ label: string; value: string; hint: string }> = [
    { label: 'Water', value: `${round1(s.waterTemp)} °C`, hint: `Air ${round1(s.airTemp)} °C` },
    { label: 'Oxygen', value: `${Math.round(s.oxygen)}`, hint: 'of 100' },
    { label: 'Nutrients', value: `${Math.round(s.nutrients)}`, hint: 'of 100' },
    { label: 'Germs', value: `${Math.round(s.pathogens)}`, hint: 'of 100' },
    { label: 'Flow', value: `${Math.round(s.flow)}`, hint: 'of 100' },
    { label: 'Shade', value: `${Math.round(s.shade * 100)}%`, hint: 'bank trees' },
    { label: 'Algae', value: `${Math.round(s.meanAlgae * 100)}%`, hint: s.bloom > 0.3 ? 'bloom' : 'cover' },
  ];
  return (
    <dl className="water-now" aria-label="Water right now">
      {items.map((it) => (
        <div key={it.label}>
          <dt>{it.label}</dt>
          <dd>
            {it.value} <span className="muted tiny">{it.hint}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Residents({ snap }: { snap: Snapshot }) {
  const tags = { sensitive: 'Sensitive', tolerant: 'Tolerant', risk: 'Risk signal', predator: 'Predator' } as const;
  return (
    <ul className="residents" aria-label="Who lives here">
      {SPECIES_IDS.map((s) => (
        <li key={s}>
          <span className="swatch" style={{ background: SPECIES_COLORS[s] }} aria-hidden="true" />
          <span className="res-name">{SPECIES[s].plural}</span>
          <span className="res-count">{snap.counts[s]}</span>
          <span className={`res-tag tag-${SPECIES[s].indicator}`}>{tags[SPECIES[s].indicator]}</span>
        </li>
      ))}
      {snap.stream.adultMosquitoes >= 0.5 && (
        <li className="muted small">+ {Math.round(snap.stream.adultMosquitoes)} adult mosquitoes flying near the banks</li>
      )}
    </ul>
  );
}

export function StreamView({
  sim,
  config,
  onOpenGuide,
  onOpenLog,
  active,
}: {
  sim: SimulationHandle;
  config: RunConfig | null;
  onOpenGuide: (section: string) => void;
  onOpenLog: () => void;
  active: boolean;
}) {
  const snap = sim.snapshot;
  const [selected, setSelected] = useState<number | null>(null);
  const [following, setFollowing] = useState(false);
  const [aiWanted, setAiWanted] = useState(() => {
    try {
      return localStorage.getItem('aquaverse:ai-wording') !== 'off';
    } catch {
      return true;
    }
  });
  const [actionDismissed, setActionDismissed] = useState(false);
  const profile = useMemo(() => (config ? buildProfile(config.answers) : null), [config]);

  useEffect(() => {
    setSelected(null);
    setFollowing(false);
    setActionDismissed(false);
  }, [config]);

  const toggleAi = (on: boolean) => {
    setAiWanted(on);
    try {
      localStorage.setItem('aquaverse:ai-wording', on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  };

  const applyStressor = (kind: StressorKind) => {
    sim.send({ type: 'stressor', kind });
    if (!snap?.playing) sim.send({ type: 'play' });
  };

  const firstStressor = sim.log.some((l) => l.kind === 'stressor');

  if (!snap) {
    return <div className="loading" role="status">Building your stream…</div>;
  }

  return (
    <div className="stream-layout">
      <section className="stage-col" aria-label="Your stream">
        {profile && (
          <p className="profile-line">
            <strong>{describeProfile(profile)}</strong>
            {profile.notes.length > 0 && <span className="muted small"> {profile.notes.join(' ')}</span>}
          </p>
        )}
        <Stage sim={sim} selectedId={selected} following={following} onSelect={(id) => { setSelected(id); if (id === null) setFollowing(false); }} active={active} />
        <Timeline
          snapshot={snap}
          log={sim.log}
          onView={(tick) => sim.send({ type: 'view', tick })}
          onLive={() => sim.send({ type: 'live' })}
          onRewind={(tick) => sim.send({ type: 'rewind', tick })}
        />
        <WaterNow snap={snap} />
        <StressorBar snapshot={snap} onApply={applyStressor} disabled={!snap.live} />
      </section>
      <aside className="side-col" aria-label="What it means">
        <OneHealthGauges gauges={snap.gauges} liveGauges={snap.liveGauges} onExplain={() => onOpenGuide('gauges')} />
        <Narrator log={sim.log} aiWanted={aiWanted} onToggleAi={toggleAi} onOpenLog={onOpenLog} />
        {firstStressor && !actionDismissed && <TakeAction onClose={() => setActionDismissed(true)} />}
        <Inspector
          snapshot={snap}
          terrain={sim.terrainRef.current}
          selectedId={selected}
          following={following}
          onFollow={setFollowing}
          onClose={() => { setSelected(null); setFollowing(false); }}
          onPick={(id) => setSelected(id)}
        />
        <section className="card" aria-labelledby="residents-title">
          <h2 id="residents-title">Who lives here</h2>
          <Residents snap={snap} />
        </section>
      </aside>
    </div>
  );
}
