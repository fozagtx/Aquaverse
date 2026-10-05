import { useEffect, useMemo, useState } from 'react';
import { SPECIES, STRESSORS } from '../engine/constants';
import type { LogEntry } from '../engine/types';
import { aiStatus, checkExplanation, rewordNarration, type AiStatus, type CheckResult } from './ai';
import { dayLabel } from './format';
import { StressorIcon } from './icons';

/** Builds the "explain it back" question from what the simulation actually did. */
function questionFor(entry: LogEntry): string {
  const f = entry.facts;
  const stressor = entry.stressor ? STRESSORS[entry.stressor].label.toLowerCase() : 'this change';
  const species = f?.species[0] ?? f?.nearDrain[0];
  if (species) {
    const name = SPECIES[species.species].plural.toLowerCase();
    return species.to < species.from
      ? `Why did the ${name} decline after the ${stressor}?`
      : `Why did the ${name} increase after the ${stressor}?`;
  }
  return `How could the ${stressor} affect the health of people living by the stream?`;
}

function ExplainBack({ entry, ai }: { entry: LogEntry; ai: AiStatus | null }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);
  const question = useMemo(() => questionFor(entry), [entry]);

  useEffect(() => {
    setResult(null);
    setRevealed(false);
    setAnswer('');
    setFailed(false);
  }, [entry.id]);

  const submit = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setResult(await checkExplanation(question, entry.text, answer));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setRevealed(true);
    }
  };

  if (!open) {
    return (
      <button className="btn small ghost" onClick={() => setOpen(true)}>
        Check your understanding
      </button>
    );
  }
  const stars = result ? Math.round(result.score) : 0;
  return (
    <div className="explain-back">
      <label htmlFor={`eb-${entry.id}`} className="eb-question">{question}</label>
      <textarea id={`eb-${entry.id}`} rows={2} maxLength={500} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer in your own words" />
      <div className="row">
        {ai?.check ? (
          <button className="btn small secondary" disabled={busy || answer.trim().length < 3} onClick={submit}>
            {busy ? 'Checking…' : 'Check my answer'}
          </button>
        ) : (
          <button className="btn small secondary" disabled={answer.trim().length < 3} onClick={() => setRevealed(true)}>
            Compare with the model
          </button>
        )}
      </div>
      {result && (
        <div className="eb-result" role="status">
          <span className="stars" aria-label={`${result.score} out of 3`}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={n <= stars ? 'star on' : 'star'} aria-hidden="true">★</span>
            ))}
          </span>
          <span>{result.level}.</span>
          {result.mentionsHealth !== null && result.mentionsHealth < 0.5 && stars < 3 && (
            <span> Tip: link it to people's health too.</span>
          )}
          <span className="muted tiny"> Scored by Jev ({Math.round(result.confidence * 100)}% sure), an AI decision model. It can be wrong.</span>
        </div>
      )}
      {failed && <p className="muted small">The AI checker is not available, so compare your answer with the model's explanation:</p>}
      {revealed && (
        <p className="eb-reference">
          <strong>What the model did:</strong> {entry.text}
        </p>
      )}
    </div>
  );
}

export function Narrator({ log, aiWanted, onToggleAi, onOpenLog }: { log: LogEntry[]; aiWanted: boolean; onToggleAi: (on: boolean) => void; onOpenLog: () => void }) {
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [reworded, setReworded] = useState<Record<number, { text: string; model: string } | 'pending' | 'failed'>>({});
  const [showRule, setShowRule] = useState(false);

  useEffect(() => {
    aiStatus().then(setAi);
  }, []);

  const explanation = useMemo(() => [...log].reverse().find((l) => l.kind === 'narration'), [log]);
  const latest = log[log.length - 1];
  const announcement = latest && latest.kind === 'stressor' && (!explanation || latest.tick >= explanation.tick) ? latest : null;

  useEffect(() => {
    if (!explanation?.facts || !ai?.narrate || !aiWanted) return;
    if (explanation.id in reworded) return;
    let alive = true;
    setReworded((r) => ({ ...r, [explanation.id]: 'pending' }));
    rewordNarration(explanation.facts, explanation.text).then((res) => {
      if (alive) setReworded((r) => ({ ...r, [explanation.id]: res ?? 'failed' }));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explanation?.id, ai?.narrate, aiWanted]);

  const wording = explanation ? reworded[explanation.id] : undefined;
  const aiText = typeof wording === 'object' ? wording : null;
  const useAi = Boolean(aiWanted && ai?.narrate && aiText && !showRule);

  return (
    <section className="card narrator" aria-labelledby="narrator-title" aria-live="polite">
      <div className="card-head">
        <h2 id="narrator-title">What just happened</h2>
        <button className="linklike small" onClick={onOpenLog}>Full log</button>
      </div>
      {announcement && (
        <p className="announce">
          {announcement.stressor && <StressorIcon kind={announcement.stressor} size={18} />} <span>{announcement.text}</span>
        </p>
      )}
      {explanation ? (
        <div className="explanation">
          <p className="explain-time muted tiny">
            {dayLabel(explanation.tick)}
            {explanation.facts?.trigger === 'followUp' && explanation.facts.secondsSince ? ` · ${Math.round(explanation.facts.secondsSince / 5)} days after the ${STRESSORS[explanation.stressor!].label.toLowerCase()}` : ''}
          </p>
          <p className="explain-text">{useAi ? aiText!.text : explanation.text}</p>
          {useAi ? (
            <p className="ai-label">
              AI-written explanation ({aiText!.model}), reworded from the rule-based facts.{' '}
              <button className="linklike tiny" onClick={() => setShowRule(true)}>Show the rule-based version</button>
            </p>
          ) : aiWanted && ai?.narrate && wording === 'pending' ? (
            <p className="muted tiny">Wording it more simply…</p>
          ) : aiWanted && ai?.narrate && wording === 'failed' ? (
            <p className="muted tiny">The AI wording could not be fetched, so this is the rule-based explanation.</p>
          ) : showRule && aiText ? (
            <p className="muted tiny">
              Rule-based explanation. <button className="linklike tiny" onClick={() => setShowRule(false)}>Show the AI wording</button>
            </p>
          ) : null}
          {explanation.facts?.trigger === 'followUp' && <ExplainBack entry={explanation} ai={ai} />}
        </div>
      ) : (
        !announcement && <p className="muted">Apply a stressor below. Each change gets a one or two sentence explanation, built only from what the simulation did.</p>
      )}
      {ai?.narrate && (
        <label className="toggle tiny">
          <input type="checkbox" checked={aiWanted} onChange={(e) => onToggleAi(e.target.checked)} /> Friendlier AI wording
        </label>
      )}
    </section>
  );
}
