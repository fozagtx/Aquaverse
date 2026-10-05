import type { CauseFacts, StreamAnswers } from '../engine/types';

/**
 * Browser client for the optional AI features. Every call has a short timeout
 * and the caller always has a rule-based fallback, so the app works without AI.
 */

export interface AiStatus {
  describe: boolean;
  check: boolean;
  narrate: boolean;
  jevModel: string;
  narratorModel: string | null;
  /** Why the helpers are off: no key on the server, switched off, or the server could not be reached. */
  reason?: 'no-key' | 'disabled' | 'unreachable' | null;
}

const OFF: AiStatus = { describe: false, check: false, narrate: false, jevModel: 'typesafe/jev', narratorModel: null, reason: 'unreachable' };

async function call<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

let statusPromise: Promise<AiStatus> | null = null;

export function aiStatus(): Promise<AiStatus> {
  if (!statusPromise) {
    statusPromise = call<AiStatus>('/api/status', { method: 'GET' }, 4000).catch(() => OFF);
  }
  return statusPromise;
}

export interface AiCheck {
  ok: boolean;
  reason?: string;
  jev?: { model: string; ok: boolean; error?: string };
  narrator?: { model: string; ok: boolean; error?: string };
}

let verifyPromise: Promise<AiCheck | null> | null = null;

/** Whether AI/ML API actually accepts the server's key for both models (checked by the server, cached there). */
export function verifyAi(): Promise<AiCheck | null> {
  if (!verifyPromise) verifyPromise = call<AiCheck>('/api/verify', { method: 'GET' }, 15000).catch(() => null);
  return verifyPromise;
}

export interface DescribeResult {
  answers: StreamAnswers;
  confidence: Record<keyof StreamAnswers, number>;
  model: string;
}

export function describeStream(text: string): Promise<DescribeResult> {
  return call<DescribeResult>(
    '/api/describe',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) },
    10000,
  );
}

export interface CheckResult {
  score: number;
  level: string;
  confidence: number;
  mentionsHealth: number | null;
  model: string;
}

export function checkExplanation(question: string, reference: string, answer: string): Promise<CheckResult> {
  return call<CheckResult>(
    '/api/check',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, reference, answer }) },
    10000,
  );
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** AI rewording of a narrator sentence. Cached in the browser; null means use the rule-based text. */
export async function rewordNarration(facts: CauseFacts, text: string): Promise<{ text: string; model: string } | null> {
  const key = `aquaverse:narrate:${fnv(text)}`;
  try {
    const hit = localStorage.getItem(key);
    if (hit) return JSON.parse(hit) as { text: string; model: string };
  } catch {
    /* storage unavailable */
  }
  try {
    const result = await call<{ text: string; model: string }>(
      '/api/narrate',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts, text }) },
      6000,
    );
    try {
      localStorage.setItem(key, JSON.stringify(result));
    } catch {
      /* storage unavailable */
    }
    return result;
  } catch {
    return null;
  }
}
