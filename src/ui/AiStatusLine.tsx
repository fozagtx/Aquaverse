import { useEffect, useState } from 'react';
import { aiStatus, verifyAi, type AiCheck, type AiStatus } from './ai';

/** One line saying whether the optional AI helpers are working, and if not, why. */
export function AiStatusLine() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [check, setCheck] = useState<AiCheck | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    aiStatus().then((s) => {
      if (!alive) return;
      setStatus(s);
      if (s.describe) verifyAi().then((c) => alive && setCheck(c));
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!status) return null;

  let tone: 'on' | 'off' | 'problem' = 'off';
  let text: string;
  if (!status.describe) {
    text =
      status.reason === 'no-key'
        ? 'AI helpers off: the server has no AIMLAPI_KEY, so everything is rule-based.'
        : status.reason === 'disabled'
          ? 'AI helpers switched off on the server (AI_DISABLED).'
          : 'AI helpers off: the server could not be reached.';
  } else if (check === undefined) {
    text = 'AI helpers: checking the key with AI/ML API…';
  } else if (check === null) {
    tone = 'problem';
    text = 'AI key is set, but the key check could not run. Try reloading.';
  } else if (check.ok) {
    tone = 'on';
    text = `AI helpers on: ${check.jev?.model} reads stream descriptions and checks answers; ${check.narrator?.model} rewords the narrator.`;
  } else if (check.reason === 'daily-limit') {
    tone = 'problem';
    text = "AI helpers paused: today's AI call limit (AI_DAILY_CALL_LIMIT) is used up.";
  } else if (check.reason === 'rate-limited') {
    tone = 'problem';
    text = 'AI key check skipped: too many requests. Try again in a minute.';
  } else {
    tone = 'problem';
    const failed = [check.jev, check.narrator].filter((p) => p && !p.ok);
    text = `AI key is set, but AI/ML API refused ${failed.map((p) => `${p!.model} (${p!.error ?? 'error'})`).join(' and ')}.`;
  }

  return (
    <p className={`ai-status ai-${tone}`} role="status">
      <span className="ai-dot" aria-hidden="true" />
      {text}
    </p>
  );
}
