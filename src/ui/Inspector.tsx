import { SPECIES, STREAM_RULES } from '../engine/constants';
import { clamp, type LocalConditions } from '../engine/stream';
import { shortfall } from '../engine/needs';
import { ACTION_KINDS, SPECIES_IDS, type SpeciesId } from '../engine/types';
import { ORG_FIELDS, type Snapshot, type TerrainPayload } from '../worker/protocol';
import { round1 } from './format';
import { SPECIES_COLORS } from './sprites';

export interface OrganismView {
  id: number;
  species: SpeciesId;
  x: number;
  y: number;
  energy: number;
  action: string;
  stress: number;
  ageDays: number;
  tolerance: number;
  generation: number;
}

export function findOrganism(snap: Snapshot, id: number): OrganismView | null {
  const o = snap.organisms;
  for (let k = 0; k < o.length; k += ORG_FIELDS) {
    if (o[k] !== id) continue;
    return {
      id,
      species: SPECIES_IDS[o[k + 1]],
      x: o[k + 2],
      y: o[k + 3],
      energy: o[k + 6],
      action: ACTION_KINDS[o[k + 7]],
      stress: o[k + 8],
      ageDays: o[k + 10] / 50,
      tolerance: o[k + 12],
      generation: o[k + 13],
    };
  }
  return null;
}

/** First creature of a species, for keyboard users who cannot click the canvas. */
export function firstOf(snap: Snapshot, species: SpeciesId, after = -1): number | null {
  const o = snap.organisms;
  const idx = SPECIES_IDS.indexOf(species);
  let first: number | null = null;
  for (let k = 0; k < o.length; k += ORG_FIELDS) {
    if (o[k + 1] !== idx) continue;
    if (first === null) first = o[k];
    if (o[k] > after) return o[k];
  }
  return first;
}

function conditionsAt(snap: Snapshot, terrain: TerrainPayload, x: number, y: number): LocalConditions {
  const i = y * terrain.width + x;
  const s = snap.stream;
  const plume = snap.plume[i] / 255;
  return {
    oxygen: clamp(s.oxygen - STREAM_RULES.plumeOxygenLoss * plume),
    waterTemp: s.waterTemp - 0.8 * terrain.localShade[i] + 0.5,
    flow: s.flow * terrain.flowFactor[i],
    shade: terrain.localShade[i],
    algae: snap.algae[i] / 255,
    plume,
  };
}

function doing(o: OrganismView, reason: string): string {
  const mosquito = o.species === 'mosquito';
  switch (o.action) {
    case 'explore':
      return o.species === 'fish' ? 'Patrolling the stream.' : 'Exploring the stream bed.';
    case 'rest':
      return 'Resting, or staying hidden among the stones.';
    case 'forage':
      return mosquito ? 'Filter-feeding at the surface of still water.' : o.species === 'midge' ? 'Feeding on algae and the sediment on the bed.' : 'Grazing algae off the stones.';
    case 'flee':
      return 'Swimming away from a fish.';
    case 'hide':
      return 'Heading for the stones to hide or shelter.';
    case 'mate':
      return 'Well fed, so looking for a mate.';
    case 'seekWater':
      return `Looking for better water: it is struggling with ${reason}.`;
    case 'hunt':
      return 'Hungry, so hunting insect larvae.';
    default:
      return '';
  }
}

const REASON_WORDS = { none: 'nothing', oxygen: 'low oxygen', temperature: 'warm water', cold: 'cold water', flow: 'the current' } as const;

export function Inspector({
  snapshot,
  terrain,
  selectedId,
  following,
  onFollow,
  onClose,
  onPick,
}: {
  snapshot: Snapshot;
  terrain: TerrainPayload | null;
  selectedId: number | null;
  following: boolean;
  onFollow: (on: boolean) => void;
  onClose: () => void;
  onPick: (id: number) => void;
}) {
  const org = selectedId !== null ? findOrganism(snapshot, selectedId) : null;

  const picker = (
    <div className="pickers" role="group" aria-label="Inspect a creature">
      {SPECIES_IDS.map((s) => {
        const next = firstOf(snapshot, s, org?.species === s ? org.id : -1);
        return (
          <button key={s} className="btn tiny ghost" disabled={next === null} onClick={() => next !== null && onPick(next)}>
            <span className="swatch" style={{ background: SPECIES_COLORS[s] }} aria-hidden="true" /> {SPECIES[s].label}
          </button>
        );
      })}
    </div>
  );

  if (selectedId === null) {
    return (
      <section className="card inspector" aria-labelledby="inspector-title">
        <h2 id="inspector-title">Meet the residents</h2>
        <p className="muted small">Click any creature in the stream, or pick one here, to see what it needs and what its presence tells you.</p>
        {picker}
      </section>
    );
  }

  if (!org || !terrain) {
    return (
      <section className="card inspector" aria-labelledby="inspector-title">
        <div className="card-head">
          <h2 id="inspector-title">Gone from the stream</h2>
          <button className="linklike small" onClick={onClose}>Close</button>
        </div>
        <p className="muted small">
          This creature is no longer here. It may have been eaten, washed away, died of poor water or old age, or grown up and
          flown off.
        </p>
        {picker}
      </section>
    );
  }

  const r = SPECIES[org.species];
  const c = conditionsAt(snapshot, terrain, org.x, org.y);
  const need = shortfall(org.species, org.tolerance, c);
  const checks: Array<{ label: string; value: string; ok: boolean }> = [];
  if (r.minOxygen > 0) {
    const min = r.minOxygen * (1 - 0.3 * org.tolerance);
    checks.push({ label: `Oxygen above ${Math.round(min)}`, value: `${Math.round(c.oxygen)}`, ok: c.oxygen >= min });
  } else {
    checks.push({ label: 'Breathes air at the surface', value: 'ignores oxygen', ok: true });
  }
  checks.push({ label: `Water below ${round1(r.maxTemp + 3 * org.tolerance)} °C`, value: `${round1(c.waterTemp)} °C`, ok: c.waterTemp <= r.maxTemp + 3 * org.tolerance });
  if (org.species === 'mosquito') {
    checks.push({ label: `Flow below ${r.maxFlow}`, value: `${Math.round(c.flow)}`, ok: c.flow <= r.maxFlow });
    checks.push({ label: `Water warmer than ${r.minTemp} °C`, value: `${round1(c.waterTemp)} °C`, ok: c.waterTemp >= r.minTemp });
  }

  return (
    <section className="card inspector" aria-labelledby="inspector-title">
      <div className="card-head">
        <h2 id="inspector-title">
          <span className="swatch big" style={{ background: SPECIES_COLORS[org.species] }} aria-hidden="true" /> {r.label} #{org.id}
        </h2>
        <button className="linklike small" onClick={onClose}>Close</button>
      </div>
      <p className="small">{r.kind}</p>
      <p className={`indicator tag-${r.indicator}`}>{r.tellsYou}</p>
      <h3>What it needs, here and now</h3>
      <ul className="needs">
        {checks.map((ch) => (
          <li key={ch.label} className={ch.ok ? 'ok' : 'bad'}>
            <span aria-hidden="true">{ch.ok ? '✓' : '✗'}</span> {ch.label}: <strong>{ch.value}</strong>
            <span className="sr-only">{ch.ok ? ' (met)' : ' (not met)'}</span>
          </li>
        ))}
      </ul>
      <h3>What it is doing</h3>
      <p className="small">{doing(org, REASON_WORDS[need.reason])}</p>
      <dl className="stats">
        <div>
          <dt>Energy</dt>
          <dd>
            <span className="mini-meter" aria-hidden="true"><span style={{ width: `${org.energy}%` }} /></span> {Math.round(org.energy)}
          </dd>
        </div>
        <div><dt>Age</dt><dd>{round1(org.ageDays)} days</dd></div>
        <div><dt>Pollution tolerance</dt><dd>{Math.round(org.tolerance * 100)}% (inherited)</dd></div>
        <div><dt>Generation</dt><dd>{org.generation}</dd></div>
      </dl>
      <div className="row">
        <button className="btn small secondary" onClick={() => onFollow(!following)}>{following ? 'Stop following' : 'Follow it'}</button>
      </div>
      {picker}
    </section>
  );
}
