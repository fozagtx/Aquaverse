import { useEffect, useState } from 'react';
import { buildProfile, describeProfile, QUESTION_ORDER, STREAM_QUESTIONS } from '../engine/streamProfile';
import type { StreamAnswerKey, StreamAnswers } from '../engine/types';
import { aiStatus, describeStream } from './ai';
import { AnswerPicture } from './icons';

type Partial5 = Partial<StreamAnswers>;

export function StreamCheck({ onDone, onCancel }: { onDone: (answers: StreamAnswers) => void; onCancel: () => void }) {
  const [answers, setAnswers] = useState<Partial5>({});
  const [aiOn, setAiOn] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiConfidence, setAiConfidence] = useState<Partial<Record<StreamAnswerKey, number>>>({});

  useEffect(() => {
    let alive = true;
    aiStatus().then((s) => alive && setAiOn(s.describe));
    return () => {
      alive = false;
    };
  }, []);

  const done = QUESTION_ORDER.filter((k) => answers[k]).length;
  const complete = done === QUESTION_ORDER.length;

  const set = (key: StreamAnswerKey, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setAiConfidence((c) => ({ ...c, [key]: undefined }));
  };

  const fillFromText = async () => {
    setBusy(true);
    setAiNote(null);
    try {
      const r = await describeStream(text);
      setAnswers(r.answers);
      setAiConfidence(r.confidence);
      const unsure = QUESTION_ORDER.filter((k) => r.answers[k] === 'unsure').length;
      setAiNote(
        `Jev (a decision model by TypeSafe AI) filled in the answers from your description${
          unsure ? `; ${unsure} ${unsure === 1 ? 'was' : 'were'} not clear enough, so "I'm not sure" is used` : ''
        }. Check them below and change anything that is wrong.`,
      );
    } catch {
      setAiNote('The AI helper is not available right now. Please pick the answers below.');
    } finally {
      setBusy(false);
    }
  };

  const preview = complete ? describeProfile(buildProfile(answers as StreamAnswers)) : null;

  return (
    <div className="check">
      <header className="check-head">
        <p className="eyebrow">Stream check · {done} of 5 answered</p>
        <h1>Describe a stream you know</h1>
        <p className="lede">
          Think of a stream, brook or urban canal near you. Pick the picture closest to what you have seen. Your answers stay in
          this browser: no location, no personal data.
        </p>
        <div className="progress-dots" aria-hidden="true">
          {QUESTION_ORDER.map((k) => (
            <span key={k} className={answers[k] ? 'on' : ''} />
          ))}
        </div>
      </header>

      {aiOn && (
        <section className="card describe-ai" aria-labelledby="describe-title">
          <h2 id="describe-title">Or describe it in your own words</h2>
          <p className="muted">
            Write a sentence or two, for example: "Slow brown water behind the shops, smells a bit, concrete sides, I only see
            red worms." An AI decision model fills in the five answers for you to check.
          </p>
          <label className="sr-only" htmlFor="describe-text">Describe your stream</label>
          <textarea
            id="describe-text"
            value={text}
            maxLength={600}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            placeholder="What does your stream look, smell and sound like?"
          />
          <div className="row">
            <button className="btn secondary" disabled={busy || text.trim().length < 8} onClick={fillFromText}>
              {busy ? 'Reading your description…' : 'Fill in the answers for me'}
            </button>
            <span className="muted small">{text.length}/600</span>
          </div>
          {aiNote && <p className="ai-note" role="status">{aiNote}</p>}
        </section>
      )}

      <form
        className="questions"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete) onDone(answers as StreamAnswers);
        }}
      >
        {QUESTION_ORDER.map((key, qi) => {
          const q = STREAM_QUESTIONS[key];
          const conf = aiConfidence[key];
          return (
            <fieldset key={key} className="question card">
              <legend>
                <span className="qnum">{qi + 1}</span> {q.question}
              </legend>
              <p className="muted small explain">{q.explain}</p>
              <div className="options">
                {q.options.map((o) => {
                  const id = `${key}-${o.value}`;
                  const checked = answers[key] === o.value;
                  return (
                    <label key={o.value} htmlFor={id} className={`option ${checked ? 'checked' : ''} ${o.value === 'unsure' ? 'unsure' : ''}`}>
                      <input
                        id={id}
                        type="radio"
                        name={key}
                        value={o.value}
                        checked={checked}
                        onChange={() => set(key, o.value)}
                      />
                      <AnswerPicture name={o.value} />
                      <span className="option-label">{o.label}</span>
                      <span className="option-hint">{o.hint}</span>
                    </label>
                  );
                })}
              </div>
              {conf !== undefined && answers[key] && (
                <p className="ai-chip">
                  Filled in by AI · {Math.round(conf * 100)}% sure
                </p>
              )}
            </fieldset>
          );
        })}

        <div className="check-foot card">
          {preview ? <p><strong>Your stream:</strong> {preview}</p> : <p className="muted">Answer all five to build your stream. "I'm not sure" counts.</p>}
          <div className="row">
            <button type="button" className="btn ghost" onClick={onCancel}>Back</button>
            <button type="submit" className="btn primary big" disabled={!complete}>
              Build my stream
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
