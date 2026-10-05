import { useEffect } from 'react';
import {
  BASE_AIR_TEMP,
  CATCH_CHANCE,
  DROUGHT_FLOW,
  HEATWAVE_DELTA,
  SECONDS_PER_DAY,
  SPECIES,
  STREAM_RULES as R,
  STRESSORS,
  TREE_GROWTH_SECONDS,
} from '../engine/constants';
import { GAUGE_WEIGHTS } from '../engine/oneHealth';
import { STRESSOR_KINDS } from '../engine/types';
import { StressorIcon } from './icons';
import { SPECIES_COLORS, SPECIES_ORDER } from './sprites';

const SECTIONS = [
  { id: 'honest', title: 'Read this first' },
  { id: 'stream', title: 'The stream' },
  { id: 'species', title: 'The four species' },
  { id: 'water', title: 'How the water works' },
  { id: 'stressors', title: 'Stressors and their chains' },
  { id: 'gauges', title: 'The One Health gauges' },
  { id: 'decisions', title: 'How animals decide' },
  { id: 'narrator', title: 'The narrator and the AI' },
  { id: 'limits', title: 'What this model leaves out' },
];

function w(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function FieldGuide({ section, onSectionShown }: { section: string | null; onSectionShown: () => void }) {
  useEffect(() => {
    if (!section) return;
    const el = document.getElementById(`guide-${section}`);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      el.focus({ preventScroll: true });
    }
    onSectionShown();
  }, [section, onSectionShown]);

  return (
    <div className="guide">
      <header className="page-head">
        <h1>Field guide</h1>
        <p className="lede">Every rule AquaVerse uses, in plain words, with its numbers.</p>
      </header>
      <div className="guide-layout">
        <nav className="guide-nav" aria-label="Field guide sections">
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#guide-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`guide-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="guide-body">
          <section id="guide-honest" tabIndex={-1} className="card callout">
            <h2>Read this first</h2>
            <p>
              <strong>All values in AquaVerse are illustrative.</strong> Every number below is a starting value chosen so the
              simulation is readable on screen. None comes from field data, and nothing on screen measures or predicts a real
              stream. Each rule is a simplified teaching assumption about how the health of a stream, its wildlife and the people
              beside it are linked: the idea behind One Health.
            </p>
            <p>
              Time is compressed: one simulated day passes every {SECONDS_PER_DAY} seconds at normal speed. The same seed, the
              same stream check answers and the same sequence of stressors always give exactly the same run.
            </p>
          </section>

          <section id="guide-stream" tabIndex={-1} className="card">
            <h2>The stream</h2>
            <p>The map is a small urban scene with a meandering channel 3 to 6 tiles wide. Water flows from left (upstream) to right (downstream).</p>
            <dl className="defs">
              <dt>Water</dt><dd>The channel. Aquatic species live only here. Holds algae on the stream bed.</dd>
              <dt>Stones and roots</dt><dd>Refuges in the channel. Fish cannot catch prey sheltering here, and flood surges cannot wash it away.</dd>
              <dt>Open bank</dt><dd>Grass. No shade. Filters a little runoff.</dd>
              <dt>Bank trees</dt><dd>Shade the water next to them and filter runoff before it reaches the stream. Planted saplings take about {TREE_GROWTH_SECONDS} seconds to grow.</dd>
              <dt>Pavement and buildings</dt><dd>Nobody swims here. More pavement means more runoff in a storm.</dd>
              <dt>Storm drain</dt><dd>Where storm runoff and sewage leaks enter. Pollution drifts downstream from it tile by tile.</dd>
            </dl>
            <p>
              Water near the banks flows at about 30% of the stream's flow, the middle at 125%, and wide pools at 80% of that. The
              still edges are where mosquito larvae can live.
            </p>
            <h3>Stream check answers</h3>
            <ul>
              <li><strong>Clarity</strong> sets starting nutrients and algae (clear 14, cloudy 34, murky 62 nutrients).</li>
              <li><strong>Smell</strong> sets starting germs and decomposing matter (none 5, earthy 14, sewage 55 germs).</li>
              <li><strong>Banks</strong> set tree cover and paving (trees 88% cover, bushes 45%, grass 8%, concrete 0% with 92% paving).</li>
              <li><strong>Creatures</strong> set the starting mix (many kinds includes mayflies; only worms means none).</li>
              <li><strong>Flow</strong> sets the base flow (fast 70, slow 45, still pools 18).</li>
              <li>"I'm not sure" always uses a middle value and the app says so.</li>
            </ul>
          </section>

          <section id="guide-species" tabIndex={-1} className="card">
            <h2>The four species</h2>
            <p>Which creatures live in a stream tells you about its water. AquaVerse uses four, each standing for a group.</p>
            <div className="species-cards">
              {SPECIES_ORDER.map((id) => {
                const s = SPECIES[id];
                return (
                  <article key={id} className="species-card">
                    <h3><span className="swatch big" style={{ background: SPECIES_COLORS[id] }} aria-hidden="true" /> {s.label}</h3>
                    <p className="small">{s.kind}</p>
                    <p className="small"><strong>Role:</strong> {s.role}</p>
                    <p className="small"><strong>Needs:</strong> {s.needsText}</p>
                    <p className="small"><strong>Tells you:</strong> {s.tellsYou}</p>
                    <p className="tiny muted">
                      Lives about {Math.round(s.maxAgeTicks / 10 / SECONDS_PER_DAY)} days{id === 'mosquito' ? ' as a larva, then flies off as a biting adult' : ''}.
                      {id !== 'mosquito' ? ` Breeds from day ${Math.round(s.maturityTicks / 10 / SECONDS_PER_DAY)}, ${s.litter[0]} to ${s.litter[1]} young.` : ' Adults lay eggs in still, warm water.'}
                    </p>
                  </article>
                );
              })}
            </div>
            <h3>Living and dying</h3>
            <ul>
              <li>Every animal has energy. Living costs energy each tick; eating restores it.</li>
              <li>
                Outside its needs, an animal loses extra energy in proportion to how far outside it is. The shortfall is measured
                against the need: for oxygen, (need minus oxygen) divided by the need; for temperature, degrees over the limit
                divided by 8. When energy runs out it dies of <em>poor water</em> (if it was stressed) or <em>starvation</em>.
              </li>
              <li>Fish catch prey next to them with a chance each tick: mosquito larvae {w(CATCH_CHANCE.mosquito)}, midges {w(CATCH_CHANCE.midge)}, mayflies {w(CATCH_CHANCE.mayfly)}. Never on stones.</li>
              <li>Breeding slows as a population approaches what the stream can support: mayflies need good water, midges thrive on organic matter, mosquitoes need still water.</li>
              <li>When the water upstream suits them, mayflies, midges and fish drift in from upstream. That is how a stream recovers.</li>
              <li>
                Each animal inherits a pollution tolerance from its parents, with small random changes. Tolerance lowers its
                oxygen need by up to 30% and raises its temperature limit by up to 3 °C, but costs up to 30% more energy. Under
                long stress, tolerant animals survive and pass it on (see Trends).
              </li>
            </ul>
          </section>

          <section id="guide-water" tabIndex={-1} className="card">
            <h2>How the water works</h2>
            <p>All values are on a 0 to 100 scale unless a unit is given. Each one moves gradually toward its target, so changes take days to show.</p>
            <dl className="defs formulas">
              <dt>Shade</dt>
              <dd><code>shade = grown bank trees beside the channel ÷ all bank tiles beside the channel</code></dd>
              <dt>Water temperature (°C)</dt>
              <dd>
                <code>target = air − {R.shadeCooling} × shade − {R.flowCooling} × flow/100 + {R.lowWaterWarming} × (low-flow warming)</code>
                <br />Summer air is {BASE_AIR_TEMP} °C. Shaded spots are slightly cooler than open water.
              </dd>
              <dt>Oxygen</dt>
              <dd>
                <code>target = 100 − {R.oxygenTempLoss} × (water − 15 °C) − {R.oxygenOrganicUse} × decomposing matter − {R.oxygenBloomPenalty} × bloom + {R.oxygenFlowGain} × (flow − 50)</code>
                <br />Warm water holds less oxygen; rotting waste and dying algae use it up; moving water mixes it in. Next to the drain, a sewage plume removes up to {R.plumeOxygenLoss} more.
              </dd>
              <dt>Nutrients</dt>
              <dd>Settle toward the stream's usual level, which rises when bank plants that filter runoff are lost or more ground is paved, and when low flow stops flushing them away. Storms and sewage add more. Growing algae use them up.</dd>
              <dt>Germs (pathogens)</dt>
              <dd>Added by sewage and storm runoff; fade over time, faster when the water flows.</dd>
              <dt>Algae</dt>
              <dd>
                <code>capacity = 0.08 + 0.95 × nutrients × light × warmth × clarity</code>, where shade cuts light by up to {Math.round(R.algaeShadeCut * 100)}%.
                Algae grow toward capacity and die back above it; dead algae become decomposing matter. A flood surge scours algae off the stones. Grazers eat it.
              </dd>
              <dt>Algal bloom</dt>
              <dd>Starts when average algae passes {Math.round(R.bloomStart * 100)}% and is full at {Math.round(R.bloomFull * 100)}%.</dd>
              <dt>Flow</dt>
              <dd>Drought cuts it to {Math.round(DROUGHT_FLOW * 100)}% of normal. A storm surges it to about 100, then it settles back over a few days.</dd>
            </dl>
          </section>

          <section id="guide-stressors" tabIndex={-1} className="card">
            <h2>Stressors and their chains</h2>
            <ul className="stressor-list">
              {STRESSOR_KINDS.map((k) => (
                <li key={k}>
                  <StressorIcon kind={k} size={22} />
                  <div>
                    <strong>{STRESSORS[k].label}.</strong> {STRESSORS[k].summary}
                    <br />
                    <span className="muted">Chain to watch: {STRESSORS[k].chain}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="small muted">The heatwave adds {HEATWAVE_DELTA} °C to the air. Storm runoff is stronger where there is more pavement and weaker where bank plants filter it.</p>
          </section>

          <section id="guide-gauges" tabIndex={-1} className="card">
            <h2>The One Health gauges</h2>
            <p>Three gauges from 0 to 100, recomputed from the simulated stream. Each shows a word (low, moderate, high), a number and its main factor, so colour is never the only signal. Low is below 34, high is 67 and above.</p>
            <h3>Ecosystem health: can the water support life?</h3>
            <ul>
              <li>Oxygen ({w(GAUGE_WEIGHTS.ecosystem.oxygen)}): full marks at 90, none at 20.</li>
              <li>Few excess nutrients ({w(GAUGE_WEIGHTS.ecosystem.nutrients)}).</li>
              <li>Shade from bank trees ({w(GAUGE_WEIGHTS.ecosystem.shade)}): full marks at 70% shade.</li>
              <li>Flow in a normal band of 30 to 75 ({w(GAUGE_WEIGHTS.ecosystem.flow)}).</li>
              <li>Algae in balance ({w(GAUGE_WEIGHTS.ecosystem.algae)}).</li>
            </ul>
            <h3>Biodiversity: how varied is the life?</h3>
            <ul>
              <li>Kinds of life present, out of four ({w(GAUGE_WEIGHTS.biodiversity.taxa)}).</li>
              <li>How evenly the numbers are spread ({w(GAUGE_WEIGHTS.biodiversity.evenness)}).</li>
              <li>Share of sensitive mayflies among the insects ({w(GAUGE_WEIGHTS.biodiversity.sensitive)}): full marks at half.</li>
            </ul>
            <h3>Human health risk: how might the stream affect people nearby?</h3>
            <ul>
              <li>Germs in the water, a contact risk ({w(GAUGE_WEIGHTS.risk.pathogens)}).</li>
              <li>Mosquitoes, larvae plus twice the adults, a bite and disease risk ({w(GAUGE_WEIGHTS.risk.mosquitoes)}).</li>
              <li>Algal blooms, a toxin risk ({w(GAUGE_WEIGHTS.risk.bloom)}).</li>
              <li>Heat on unshaded banks ({w(GAUGE_WEIGHTS.risk.heat)}).</li>
            </ul>
            <p className="muted small">These weights are teaching assumptions, not a validated health index.</p>
          </section>

          <section id="guide-decisions" tabIndex={-1} className="card">
            <h2>How animals decide</h2>
            <p>Every animal follows the same simple rules, checked in order. No AI is involved, so runs are free and reproducible.</p>
            <h3>Insect larvae</h3>
            <ol>
              <li>A fish is within 4 tiles: hide among stones if they are within 3 tiles, otherwise swim away.</li>
              <li>The current is strong: shelter behind nearby stones, or move to slower water.</li>
              <li>The water does not suit it: move to a better spot nearby if there is one.</li>
              <li>Energy below 70: feed.</li>
              <li>Ready to breed and a partner is near: mate (mosquito larvae do not breed; adults lay eggs).</li>
              <li>Otherwise explore.</li>
            </ol>
            <h3>Fish</h3>
            <ol>
              <li>The water does not suit it: look for cooler, better water.</li>
              <li>Energy below 85 and prey in sight: hunt the nearest prey that is not hiding.</li>
              <li>Ready to breed: mate.</li>
              <li>Otherwise patrol.</li>
            </ol>
          </section>

          <section id="guide-narrator" tabIndex={-1} className="card">
            <h2>The narrator and the AI</h2>
            <p>
              The narrator is rule-based. After each stressor it compares the stream now with the moment the stressor started and
              turns the facts (the stressor, the water variables that moved, the species that changed, the gauges that moved)
              into one or two sentences. It cannot say anything the simulation did not do.
            </p>
            <p>When the site has an AI key configured, three optional helpers appear. All are clearly labelled and all have a rule-based fallback.</p>
            <ul>
              <li><strong>Describe your stream in words</strong>: Jev, a decision model by TypeSafe AI (served through AI/ML API), picks the closest answer to each of the five questions, with a probability. Below 50% confidence it uses "I'm not sure". You check every answer before your stream is built.</li>
              <li><strong>Friendlier wording</strong>: a small, low-cost language model rewords the narrator's sentence from the same facts. It never decides outcomes, and any wording with numbers that were not in the facts is rejected.</li>
              <li><strong>Check your understanding</strong>: Jev scores your own explanation from 0 to 3 against the model's explanation.</li>
            </ul>
            <p className="small muted">The AI only ever receives your description, your answer, or the narrator's facts: never your location or anything about you. The key stays on the server, with a daily cap, a per-visitor rate limit and caching.</p>
          </section>

          <section id="guide-limits" tabIndex={-1} className="card">
            <h2>What this model leaves out</h2>
            <ul>
              <li>Real streams have hundreds of species; AquaVerse has four stand-ins.</li>
              <li>Water chemistry is reduced to a handful of 0 to 100 scores, mostly the same along the whole stream.</li>
              <li>There are no seasons, nights, floods from upstream, groundwater or chemicals other than nutrients and germs.</li>
              <li>Time is compressed: days pass in seconds, and lifespans are shortened to fit.</li>
              <li>Human health risk is a teaching index, not an epidemiological estimate.</li>
            </ul>
            <p>For a real assessment of a stream near you, contribute observations through the OneAquaHealth citizen science app and talk to your local environment agency.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
