import { useCallback, useEffect, useRef, useState } from 'react';
import { parseRunExport } from '../engine/runtime';
import { AiStatusLine } from './AiStatusLine';
import { isValidAnswers, QUESTION_ORDER, SAMPLE_ANSWERS } from '../engine/streamProfile';
import type { RunConfig, StreamAnswers } from '../engine/types';
import { FieldGuide } from './FieldGuide';
import { Logo } from './icons';
import { Landing } from './Landing';
import { StreamCheck } from './StreamCheck';
import { StreamLog } from './StreamLog';
import { StreamView } from './StreamView';
import { Trends } from './Trends';
import { useSimulation } from './useSimulation';

export type Tab = 'stream' | 'trends' | 'log' | 'guide';
type Screen = 'landing' | 'check' | 'stream';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'stream', label: 'Stream' },
  { id: 'trends', label: 'Trends' },
  { id: 'log', label: 'Stream log' },
  { id: 'guide', label: 'Field guide' },
];

export const SAMPLE_SEED = 2026;

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % 1_000_000;
}

/** Reads a shared stream from the address bar: #s=SEED&a=clear,none,bushes,many,fast */
function configFromHash(): RunConfig | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const seed = Number(params.get('s'));
  const parts = (params.get('a') ?? '').split(',');
  if (!Number.isInteger(seed) || seed < 0 || parts.length !== 5) return null;
  const answers = Object.fromEntries(QUESTION_ORDER.map((k, i) => [k, parts[i]])) as unknown as StreamAnswers;
  return isValidAnswers(answers) ? { seed, answers } : null;
}

export function shareLink(config: RunConfig): string {
  const a = QUESTION_ORDER.map((k) => config.answers[k]).join(',');
  return `${location.origin}${location.pathname}#s=${config.seed}&a=${a}`;
}

export function App() {
  const sim = useSimulation();
  const [screen, setScreen] = useState<Screen>('landing');
  const [tab, setTab] = useState<Tab>('stream');
  const [guideSection, setGuideSection] = useState<string | null>(null);
  const [config, setConfig] = useState<RunConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const start = useCallback(
    (answers: StreamAnswers, seed = randomSeed()) => {
      const cfg = { seed, answers };
      setConfig(cfg);
      sim.send({ type: 'init', config: cfg, play: true });
      setScreen('stream');
      setTab('stream');
      history.replaceState(null, '', `#s=${seed}&a=${QUESTION_ORDER.map((k) => answers[k]).join(',')}`);
    },
    [sim],
  );

  useEffect(() => {
    const shared = configFromHash();
    if (shared) start(shared.answers, shared.seed);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [screen, tab]);

  const openGuide = useCallback((section: string) => {
    setGuideSection(section);
    setTab('guide');
  }, []);

  const saveRun = useCallback(async () => {
    const data = await sim.exportRun();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aquaverse-run-${data.seed}-day${Math.round(data.endTick / 50)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Run saved. Load it later to replay exactly the same stream.');
  }, [sim]);

  const loadRun = useCallback(
    async (file: File) => {
      try {
        const data = parseRunExport(JSON.parse(await file.text()));
        if (!data) throw new Error('bad file');
        const cfg = { seed: data.seed, answers: data.answers };
        setConfig(cfg);
        sim.send({ type: 'init', config: cfg, script: data.script, endTick: data.endTick, play: false });
        setScreen('stream');
        setTab('stream');
        setNotice('Run loaded and replayed to where it was saved. Press play to continue.');
      } catch {
        setNotice('That file is not an AquaVerse run.');
      }
    },
    [sim],
  );

  const copyLink = useCallback(async () => {
    if (!config) return;
    try {
      await navigator.clipboard.writeText(shareLink(config));
      setNotice('Link copied. It opens this same stream for anyone.');
    } catch {
      setNotice(shareLink(config));
    }
  }, [config]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <button className="brand" onClick={() => setScreen('landing')} aria-label="AquaVerse home">
          <Logo size={26} />
          <span>AquaVerse</span>
        </button>
        {screen === 'stream' ? (
          <nav className="tabs" aria-label="Views">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab ${tab === t.id ? 'active' : ''}`}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        ) : (
          <div className="tabs-spacer" />
        )}
        <div className="top-actions">
          {screen === 'stream' ? (
            <>
              <button className="btn ghost small" onClick={() => setScreen('check')}>New stream</button>
              <details className="menu">
                <summary className="btn ghost small" aria-label="More options">More</summary>
                <div className="menu-panel" role="menu">
                  <button role="menuitem" onClick={copyLink}>Copy link to this stream</button>
                  <button role="menuitem" onClick={saveRun}>Save run as a file</button>
                  <button role="menuitem" onClick={() => fileInput.current?.click()}>Load a saved run</button>
                </div>
              </details>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => { setScreen('stream'); setTab('guide'); if (!config) start(SAMPLE_ANSWERS, SAMPLE_SEED); }}>
              Field guide
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadRun(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className={`screen-${screen}`}>
        {screen === 'landing' && (
          <Landing onCheck={() => setScreen('check')} onSample={() => start(SAMPLE_ANSWERS, SAMPLE_SEED)} onLoad={() => fileInput.current?.click()} />
        )}
        {screen === 'check' && <StreamCheck onDone={(a: StreamAnswers) => start(a)} onCancel={() => setScreen(config ? 'stream' : 'landing')} />}
        {screen === 'stream' && (
          <>
            {sim.progress && (
              <div className="progress" role="status">
                Replaying saved run… day {Math.round(sim.progress.done / 50)} of {Math.round(sim.progress.total / 50)}
              </div>
            )}
            {sim.error && <div className="alert" role="alert">Something went wrong: {sim.error}</div>}
            <div hidden={tab !== 'stream'}>
              <StreamView sim={sim} config={config} onOpenGuide={openGuide} onOpenLog={() => setTab('log')} active={tab === 'stream'} />
            </div>
            {tab === 'trends' && <Trends history={sim.history} log={sim.log} />}
            {tab === 'log' && <StreamLog log={sim.log} />}
            {tab === 'guide' && <FieldGuide section={guideSection} onSectionShown={() => setGuideSection(null)} />}
          </>
        )}
      </main>

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}

      <footer className="footer">
        <AiStatusLine />
        <p>
          AquaVerse is an illustrative teaching model. It does not measure or predict any real stream. Built for the OneAquaHealth
          IEEE Global Hackathon, Track 4: Awareness &amp; Storytelling.
        </p>
      </footer>
    </div>
  );
}
