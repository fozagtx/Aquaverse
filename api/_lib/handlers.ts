import { createHash } from 'node:crypto';

/**
 * Server-side AI helpers for AquaVerse, powered by AI/ML API (aimlapi.com).
 *
 * - typesafe/jev (POST /v1/decisions): a decision model that returns typed
 *   answers with probabilities. Used to read a free-text stream description
 *   into the five stream check answers, and to score a learner's explanation.
 *   Billed on input tokens only, about $0.00002 per call.
 * - A very cheap chat model (default amazon/nova-micro-v1) rewords the
 *   narrator's rule-based sentence. It never decides outcomes or adds numbers.
 *
 * The key stays on the server. Every call is capped per day, rate limited per
 * visitor and cached, so a public page cannot run up the bill.
 */

export interface AiEnv {
  AIMLAPI_KEY?: string;
  AIMLAPI_NARRATOR_MODEL?: string;
  AI_DAILY_CALL_LIMIT?: string;
  AI_DISABLED?: string;
}

export interface HandlerContext {
  env: AiEnv;
  fetch: typeof fetch;
  ip: string;
  now?: number;
}

export interface ApiResult {
  status: number;
  body: unknown;
}

export const AIML_BASE = 'https://api.aimlapi.com/v1';
export const JEV_MODEL = 'typesafe/jev';
export const DEFAULT_NARRATOR_MODEL = 'amazon/nova-micro-v1';
const UPSTREAM_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------- guards

class DailyBudget {
  private day = '';
  private used = 0;
  take(limit: number, now: number): boolean {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= limit) return false;
    this.used++;
    return true;
  }
  reset(): void {
    this.day = '';
    this.used = 0;
  }
}

class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly perMinute: number) {}
  allow(ip: string, now: number): boolean {
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 5000) this.hits.clear();
    return true;
  }
  reset(): void {
    this.hits.clear();
  }
}

class Lru<V> {
  private map = new Map<string, V>();
  constructor(private readonly size: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value as string);
  }
  reset(): void {
    this.map.clear();
  }
}

const budget = new DailyBudget();
const limiter = new RateLimiter(12);
const cache = new Lru<unknown>(400);

/** Clears in-memory guards (tests only). */
export function resetGuards(): void {
  budget.reset();
  limiter.reset();
  cache.reset();
}

function hashKey(kind: string, payload: unknown): string {
  return createHash('sha256').update(kind).update(JSON.stringify(payload)).digest('hex');
}

function aiEnabled(env: AiEnv): boolean {
  return Boolean(env.AIMLAPI_KEY) && env.AI_DISABLED !== '1' && env.AI_DISABLED !== 'true';
}

function dailyLimit(env: AiEnv): number {
  const n = Number(env.AI_DAILY_CALL_LIMIT);
  return Number.isFinite(n) && n >= 0 ? n : 400;
}

function narratorModel(env: AiEnv): string {
  const m = (env.AIMLAPI_NARRATOR_MODEL ?? '').trim();
  return /^[\w./:-]{3,80}$/.test(m) ? m : DEFAULT_NARRATOR_MODEL;
}

/** Shared gate: key present, visitor not flooding, daily budget left. Returns an error result or null. */
function gate(ctx: HandlerContext): ApiResult | null {
  if (!aiEnabled(ctx.env)) return { status: 503, body: { error: 'ai-unavailable' } };
  const now = ctx.now ?? Date.now();
  if (!limiter.allow(ctx.ip || 'unknown', now)) return { status: 429, body: { error: 'rate-limited' } };
  if (!budget.take(dailyLimit(ctx.env), now)) return { status: 429, body: { error: 'daily-limit' } };
  return null;
}

async function postJson(ctx: HandlerContext, path: string, payload: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await ctx.fetch(`${AIML_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.env.AIMLAPI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > max) return null;
  return t;
}

// ---------------------------------------------------------------- status

export function handleStatus(env: AiEnv): ApiResult {
  const on = aiEnabled(env);
  return {
    status: 200,
    body: { describe: on, check: on, narrate: on, jevModel: JEV_MODEL, narratorModel: on ? narratorModel(env) : null },
  };
}

// ---------------------------------------------------------------- describe (Jev)

type ChoiceAnswer = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
type ScoreAnswer = { type: 'score'; score: number; confidence: number };
type NoulAnswer = { type: 'noul'; noul: number };

export const DESCRIBE_QUESTIONS = {
  clarity: {
    type: 'choice',
    instructions: 'How clear is the water in this stream?',
    criteria: {
      clear: 'Clear water, you can see the bottom or stones',
      cloudy: 'A bit cloudy, slightly coloured or hazy',
      murky: 'Murky, brown, green, soupy or full of algae',
      unknown: 'The description does not say how clear the water is',
    },
  },
  smell: {
    type: 'choice',
    instructions: 'What does the stream smell like?',
    criteria: {
      none: 'No smell, or a fresh smell',
      earthy: 'An earthy smell like soil, mud or wet leaves',
      sewage: 'Smells of sewage, drains, rotten eggs or something foul',
      unknown: 'The description does not mention a smell',
    },
  },
  banks: {
    type: 'choice',
    instructions: 'What grows on, or covers, the stream banks?',
    criteria: {
      trees: 'Trees on both sides, shady banks',
      bushes: 'Some bushes, shrubs or a few trees',
      grass: 'Mown grass, lawn or open ground',
      concrete: 'Concrete, walls, paving or a built channel',
      unknown: 'The description does not mention the banks',
    },
  },
  creatures: {
    type: 'choice',
    instructions: 'What small creatures live in the stream?',
    criteria: {
      many: 'Many kinds of creatures such as insects, fish, snails or shrimps',
      few: 'A few kinds of creatures, one or two sorts',
      worms: 'Only worms, or no creatures at all',
      unknown: 'The description does not mention any creatures',
    },
  },
  flow: {
    type: 'choice',
    instructions: 'How does the water move?',
    criteria: {
      fast: 'Fast, rippling, splashing or rushing',
      slow: 'Slow but moving',
      still: 'Still, stagnant or standing pools',
      unknown: 'The description does not say how the water moves',
    },
  },
} as const;

/** Below this confidence an answer becomes "I'm not sure". */
export const DESCRIBE_MIN_CONFIDENCE = 0.5;

export async function handleDescribe(body: unknown, ctx: HandlerContext): Promise<ApiResult> {
  const text = cleanText((body as { text?: unknown } | null)?.text, 600);
  if (!text || text.length < 8) return { status: 400, body: { error: 'Describe your stream in 8 to 600 characters.' } };
  const key = hashKey('describe', text.toLowerCase());
  const cached = cache.get(key);
  if (cached) return { status: 200, body: { ...(cached as object), cached: true } };
  const blocked = gate(ctx);
  if (blocked) return blocked;
  try {
    const data = (await postJson(ctx, '/decisions', { model: JEV_MODEL, state: text, questions: DESCRIBE_QUESTIONS })) as {
      model?: string;
      answers?: Record<string, ChoiceAnswer>;
    };
    const answers: Record<string, string> = {};
    const confidence: Record<string, number> = {};
    for (const q of Object.keys(DESCRIBE_QUESTIONS) as Array<keyof typeof DESCRIBE_QUESTIONS>) {
      const a = data.answers?.[q];
      const valid = a && a.type === 'choice' && a.choice in DESCRIBE_QUESTIONS[q].criteria;
      const conf = valid ? clamp01(a.confidence) : 0;
      answers[q] = valid && a.choice !== 'unknown' && conf >= DESCRIBE_MIN_CONFIDENCE ? a.choice : 'unsure';
      confidence[q] = Math.round(conf * 100) / 100;
    }
    const result = { answers, confidence, model: typeof data.model === 'string' ? data.model : JEV_MODEL };
    cache.set(key, result);
    return { status: 200, body: result };
  } catch {
    return { status: 502, body: { error: 'upstream' } };
  }
}

// ---------------------------------------------------------------- check an explanation (Jev)

export const CHECK_LEVELS = [
  'Does not give a relevant reason',
  "Names a cause but not how it affects the stream's life",
  'Explains how the cause changed the water and the wildlife',
  "Explains the full chain from the cause, through the water and wildlife, to people's health",
];

export async function handleCheck(body: unknown, ctx: HandlerContext): Promise<ApiResult> {
  const b = (body ?? {}) as { question?: unknown; reference?: unknown; answer?: unknown };
  const question = cleanText(b.question, 200);
  const reference = cleanText(b.reference, 500);
  const answer = cleanText(b.answer, 500);
  if (!question || !reference || !answer || answer.length < 3) {
    return { status: 400, body: { error: 'Write a short answer (3 to 500 characters).' } };
  }
  const state = { question, reference_explanation: reference, learner_answer: answer };
  const key = hashKey('check', state);
  const cached = cache.get(key);
  if (cached) return { status: 200, body: { ...(cached as object), cached: true } };
  const blocked = gate(ctx);
  if (blocked) return blocked;
  try {
    const data = (await postJson(ctx, '/decisions', {
      model: JEV_MODEL,
      state,
      questions: {
        understanding: {
          type: 'score',
          instructions: "How well does the learner's answer explain the cause and effect in the reference explanation?",
          criteria: CHECK_LEVELS,
        },
        mentions_health: {
          type: 'noul',
          instructions: "Does the learner's answer mention an effect on people's health?",
        },
      },
    })) as { model?: string; answers?: { understanding?: ScoreAnswer; mentions_health?: NoulAnswer } };
    const u = data.answers?.understanding;
    const h = data.answers?.mentions_health;
    if (!u || u.type !== 'score' || !Number.isFinite(u.score)) return { status: 502, body: { error: 'upstream' } };
    const score = Math.max(0, Math.min(CHECK_LEVELS.length - 1, u.score));
    const result = {
      score: Math.round(score * 10) / 10,
      level: CHECK_LEVELS[Math.round(score)],
      confidence: Math.round(clamp01(u.confidence) * 100) / 100,
      mentionsHealth: h && h.type === 'noul' ? Math.round(clamp01(h.noul) * 100) / 100 : null,
      model: typeof data.model === 'string' ? data.model : JEV_MODEL,
    };
    cache.set(key, result);
    return { status: 200, body: result };
  } catch {
    return { status: 502, body: { error: 'upstream' } };
  }
}

// ---------------------------------------------------------------- narrate (cheap chat model)

const NARRATOR_SYSTEM = [
  'You reword facts from an educational stream simulation for people who live near the stream.',
  'Rules: use only the facts given. Do not add numbers, species, causes, places or advice that are not in the facts.',
  "Keep the order: cause, then what happened to the water and wildlife, then what it means for people's health.",
  'Write one or two short sentences, at most 45 words, in plain friendly words. No lists, no emojis, no quotes.',
].join(' ');

/** Keeps only the fields the narrator may use, so nothing else reaches the model. */
export function sanitizeFacts(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const str = (v: unknown, max = 60) => (typeof v === 'string' && v.length <= max ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const list = (v: unknown, keys: string[]) =>
    Array.isArray(v)
      ? v.slice(0, 8).map((item) => {
          const o = (item ?? {}) as Record<string, unknown>;
          return Object.fromEntries(keys.map((k) => [k, typeof o[k] === 'number' ? num(o[k]) : str(o[k])]));
        })
      : [];
  const risk = (f.risk ?? {}) as Record<string, unknown>;
  return {
    stressor: str(f.stressor),
    secondsSince: num(f.secondsSince),
    variables: list(f.variables, ['key', 'from', 'to']),
    species: list(f.species, ['species', 'from', 'to']),
    nearDrain: list(f.nearDrain, ['species', 'from', 'to']),
    washedOut: num(f.washedOut),
    stressed: Array.isArray(f.stressed) ? f.stressed.slice(0, 4).map((s) => str(s, 12)) : [],
    gauges: list(f.gauges, ['gauge', 'from', 'to', 'toBand', 'topPhrase']),
    risk: { band: str(risk.band, 10), topPhrase: str(risk.topPhrase) },
  };
}

function numbersIn(s: string): string[] {
  return s.match(/\d+(?:[.,]\d+)?/g) ?? [];
}

/** The reworded text must not contain numbers the rule-based sentence did not have. */
export function acceptRewording(candidate: string, template: string): string | null {
  let t = candidate.trim().replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ');
  if (t.length < 20 || t.length > 360) return null;
  const allowed = new Set(numbersIn(template));
  if (numbersIn(t).some((n) => !allowed.has(n))) return null;
  if (/https?:|www\.|<|>/.test(t)) return null;
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

export async function handleNarrate(body: unknown, ctx: HandlerContext): Promise<ApiResult> {
  const b = (body ?? {}) as { facts?: unknown; text?: unknown };
  const facts = sanitizeFacts(b.facts);
  const template = cleanText(b.text, 500);
  if (!facts || !template) return { status: 400, body: { error: 'Missing facts or text.' } };
  const model = narratorModel(ctx.env);
  const key = hashKey('narrate', { model, facts, template });
  const cached = cache.get(key);
  if (cached) return { status: 200, body: { ...(cached as object), cached: true } };
  const blocked = gate(ctx);
  if (blocked) return blocked;
  try {
    const data = (await postJson(ctx, '/chat/completions', {
      model,
      max_tokens: 110,
      temperature: 0.4,
      messages: [
        { role: 'system', content: NARRATOR_SYSTEM },
        {
          role: 'user',
          content: `Facts (JSON): ${JSON.stringify(facts)}\nRule-based sentence: "${template}"\nRewrite the rule-based sentence so it is friendlier to read.`,
        },
      ],
    })) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? acceptRewording(content, template) : null;
    if (!text) return { status: 502, body: { error: 'rejected' } };
    const result = { text, model };
    cache.set(key, result);
    return { status: 200, body: result };
  } catch {
    return { status: 502, body: { error: 'upstream' } };
  }
}

function clamp01(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

// ---------------------------------------------------------------- routing

export const MAX_BODY_BYTES = 8 * 1024;

/** Routes one API request. Used by the Vercel functions and the dev server. */
export async function route(name: string, method: string, rawBody: string, ctx: HandlerContext): Promise<ApiResult> {
  if (name === 'status') {
    if (method !== 'GET') return { status: 405, body: { error: 'method' } };
    return handleStatus(ctx.env);
  }
  if (method !== 'POST') return { status: 405, body: { error: 'method' } };
  if (rawBody.length > MAX_BODY_BYTES) return { status: 413, body: { error: 'too-large' } };
  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { status: 400, body: { error: 'bad-json' } };
  }
  if (name === 'describe') return handleDescribe(body, ctx);
  if (name === 'check') return handleCheck(body, ctx);
  if (name === 'narrate') return handleNarrate(body, ctx);
  return { status: 404, body: { error: 'not-found' } };
}

/** Adapter for Web-standard Request/Response (Vercel functions). */
export async function respond(name: string, request: Request): Promise<Response> {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  const raw = request.method === 'POST' ? await request.text() : '';
  const result = await route(name, request.method, raw, { env: process.env as AiEnv, fetch, ip });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
