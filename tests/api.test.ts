import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptRewording,
  DEFAULT_NARRATOR_MODEL,
  handleCheck,
  handleDescribe,
  handleNarrate,
  handleStatus,
  handleVerify,
  JEV_MODEL,
  resetGuards,
  route,
  sanitizeFacts,
  type HandlerContext,
} from '../server/ai';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ctx(fetchImpl: typeof fetch, env: HandlerContext['env'] = { AIMLAPI_KEY: 'test-key' }, ip = '1.2.3.4'): HandlerContext {
  return { env, fetch: fetchImpl, ip, now: Date.UTC(2026, 9, 5, 12) };
}

const jevDescribeReply = {
  model: 'typesafe/jev-1.13-20260917',
  answers: {
    clarity: { type: 'choice', choice: 'murky', confidence: 0.91, probabilities: {} },
    smell: { type: 'choice', choice: 'sewage', confidence: 0.83, probabilities: {} },
    banks: { type: 'choice', choice: 'concrete', confidence: 0.77, probabilities: {} },
    creatures: { type: 'choice', choice: 'unknown', confidence: 0.9, probabilities: {} },
    flow: { type: 'choice', choice: 'still', confidence: 0.3, probabilities: {} },
  },
  usage: { input_tokens: 420, output_tokens: 60 },
};

beforeEach(() => resetGuards());

describe('AI status', () => {
  it('reports AI as unavailable without a key, so the app falls back to rules', () => {
    expect(handleStatus({})).toEqual({ status: 200, body: expect.objectContaining({ describe: false, narrate: false }) });
    expect(handleStatus({ AIMLAPI_KEY: 'k' }).body).toEqual(expect.objectContaining({ describe: true, narratorModel: DEFAULT_NARRATOR_MODEL }));
    expect(handleStatus({ AIMLAPI_KEY: 'k', AI_DISABLED: '1' }).body).toEqual(expect.objectContaining({ describe: false }));
  });

  it('says why the helpers are off', () => {
    expect(handleStatus({}).body).toEqual(expect.objectContaining({ reason: 'no-key' }));
    expect(handleStatus({ AIMLAPI_KEY: 'k', AI_DISABLED: 'true' }).body).toEqual(expect.objectContaining({ reason: 'disabled' }));
    expect(handleStatus({ AIMLAPI_KEY: 'k' }).body).toEqual(expect.objectContaining({ reason: null }));
  });
});

describe('key check (/api/verify)', () => {
  const jevOk = { model: 'typesafe/jev-1.13', answers: { about_water: { type: 'noul', noul: 0.98 } } };
  const chatOk = { choices: [{ message: { content: 'ready' } }] };
  const upstream = (decisions: Response, chat: Response) =>
    vi.fn(async (url: string) => (url.endsWith('/decisions') ? decisions.clone() : chat.clone()));

  it('needs no call when there is no key', async () => {
    const f = vi.fn();
    const res = await handleVerify(ctx(f as unknown as typeof fetch, {}));
    expect(res.body).toEqual({ ok: false, reason: 'no-key' });
    expect(f).not.toHaveBeenCalled();
  });

  it('proves both models work, then reuses the result instead of spending credit', async () => {
    const f = upstream(jsonResponse(jevOk), jsonResponse(chatOk));
    const first = await handleVerify(ctx(f as unknown as typeof fetch));
    expect(first.body).toEqual({ ok: true, jev: { model: JEV_MODEL, ok: true }, narrator: { model: DEFAULT_NARRATOR_MODEL, ok: true } });
    expect(f).toHaveBeenCalledTimes(2);
    await handleVerify(ctx(f as unknown as typeof fetch));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('reports what AI/ML API said when it refuses the key, and logs it without the key', async () => {
    const logs: string[] = [];
    const refused = new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 });
    const f = upstream(refused, refused);
    const res = await handleVerify({ ...ctx(f as unknown as typeof fetch, { AIMLAPI_KEY: 'secret-key-123' }), log: (m) => logs.push(m) });
    const body = res.body as { ok: boolean; jev: { ok: boolean; error: string }; narrator: { ok: boolean; error: string } };
    expect(body.ok).toBe(false);
    expect(body.jev.error).toMatch(/^upstream 401: .*Invalid API key/);
    expect(body.narrator.ok).toBe(false);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/^\[ai\] (jev|narrator) check failed: upstream 401/);
    expect(logs.join(' ')).not.toContain('secret-key-123');
  });

  it('can point at a stand-in API for testing', async () => {
    const f = upstream(jsonResponse(jevOk), jsonResponse(chatOk));
    await handleVerify(ctx(f as unknown as typeof fetch, { AIMLAPI_KEY: 'k', AIMLAPI_BASE_URL: 'http://127.0.0.1:9999/v1/' }));
    expect(f.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['http://127.0.0.1:9999/v1/decisions', 'http://127.0.0.1:9999/v1/chat/completions']));
  });
});

describe('failed calls are logged', () => {
  it('writes the upstream status to the log when a helper fails', async () => {
    const logs: string[] = [];
    const f = vi.fn(async () => new Response('insufficient credits', { status: 402 }));
    const res = await handleDescribe({ text: 'Clear water over stones, lots of bugs.' }, { ...ctx(f as unknown as typeof fetch), log: (m) => logs.push(m) });
    expect(res.status).toBe(502);
    expect(logs).toEqual(['[ai] describe failed: upstream 402: insufficient credits']);
  });
});

describe('describe a stream with typesafe/jev', () => {
  it('sends a decisions request and maps answers, using "unsure" when Jev is not confident', async () => {
    const f = vi.fn(async () => jsonResponse(jevDescribeReply));
    const res = await handleDescribe({ text: 'Green murky water behind the car park, smells like drains, concrete walls.' }, ctx(f as unknown as typeof fetch));
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.aimlapi.com/v1/decisions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe(JEV_MODEL);
    expect(Object.keys(sent.questions)).toEqual(['clarity', 'smell', 'banks', 'creatures', 'flow']);
    expect(sent.questions.clarity.type).toBe('choice');
    const body = res.body as { answers: Record<string, string>; confidence: Record<string, number> };
    expect(body.answers).toEqual({ clarity: 'murky', smell: 'sewage', banks: 'concrete', creatures: 'unsure', flow: 'unsure' });
    expect(body.confidence.clarity).toBe(0.91);
  });

  it('caches identical descriptions so they cost nothing the second time', async () => {
    const f = vi.fn(async () => jsonResponse(jevDescribeReply));
    const c = ctx(f as unknown as typeof fetch);
    await handleDescribe({ text: 'Clear fast water with trees' }, c);
    const again = await handleDescribe({ text: 'clear fast water with trees' }, c);
    expect(f).toHaveBeenCalledTimes(1);
    expect((again.body as { cached?: boolean }).cached).toBe(true);
  });

  it('rejects empty or huge input without calling the API', async () => {
    const f = vi.fn();
    expect((await handleDescribe({ text: 'hi' }, ctx(f as unknown as typeof fetch))).status).toBe(400);
    expect((await handleDescribe({ text: 'x'.repeat(700) }, ctx(f as unknown as typeof fetch))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('returns 503 without a key and 502 when the upstream fails', async () => {
    const f = vi.fn(async () => jsonResponse({ error: 'boom' }, 500));
    expect((await handleDescribe({ text: 'muddy and slow stream' }, ctx(f as unknown as typeof fetch, {}))).status).toBe(503);
    expect((await handleDescribe({ text: 'muddy and slow stream' }, ctx(f as unknown as typeof fetch))).status).toBe(502);
  });
});

describe('credit protection', () => {
  it('rate limits one visitor to 12 calls a minute', async () => {
    const f = vi.fn(async () => jsonResponse(jevDescribeReply));
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      statuses.push((await handleDescribe({ text: `stream description number ${i}` }, ctx(f as unknown as typeof fetch))).status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(12);
    expect(statuses.slice(-2)).toEqual([429, 429]);
  });

  it('stops at the daily call limit', async () => {
    const f = vi.fn(async () => jsonResponse(jevDescribeReply));
    const env = { AIMLAPI_KEY: 'k', AI_DAILY_CALL_LIMIT: '2' };
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push((await handleDescribe({ text: `another stream ${i}` }, ctx(f as unknown as typeof fetch, env, `10.0.0.${i}`))).status);
    }
    expect(results).toEqual([200, 200, 429]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized bodies and wrong methods at the router', async () => {
    const f = vi.fn();
    const c = ctx(f as unknown as typeof fetch);
    expect((await route('describe', 'POST', 'x'.repeat(9000), c)).status).toBe(413);
    expect((await route('describe', 'GET', '', c)).status).toBe(405);
    expect((await route('nope', 'POST', '{}', c)).status).toBe(404);
    expect((await route('describe', 'POST', '{bad', c)).status).toBe(400);
  });
});

describe('check an explanation with typesafe/jev', () => {
  it('returns a 0-3 score and whether health was mentioned', async () => {
    const f = vi.fn(async () =>
      jsonResponse({
        model: 'typesafe/jev',
        answers: {
          understanding: { type: 'score', score: 2.4, confidence: 0.6, legend: {}, probabilities: {} },
          mentions_health: { type: 'noul', noul: 0.82 },
        },
      }),
    );
    const res = await handleCheck(
      { question: 'Why did the mayflies disappear?', reference: 'The heatwave warmed the water so oxygen fell.', answer: 'Hot water holds less oxygen so they suffocate' },
      ctx(f as unknown as typeof fetch),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ score: 2.4, confidence: 0.6, mentionsHealth: 0.82 }));
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.questions.understanding.type).toBe('score');
    expect(sent.questions.understanding.criteria).toHaveLength(4);
    expect(sent.questions.mentions_health.type).toBe('noul');
  });
});

describe('narrator rewording with a cheap chat model', () => {
  const template = 'The heatwave heated the air, so the water warmed by 6.6 °C and oxygen fell. Mayflies are struggling.';
  const facts = { trigger: 'followUp', stressor: 'heatwave', secondsSince: 20, variables: [{ key: 'waterTemp', from: 20, to: 26.6 }], species: [], nearDrain: [], washedOut: 0, stressed: ['mayfly'], gauges: [], risk: { value: 20, band: 'low', topKey: 'heat', topPhrase: 'the heat' }, secret: 'x' };

  it('uses the cheap default model, passes only whitelisted facts and labels the output', async () => {
    const f = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'The heatwave warmed the water by 6.6 °C, so it holds less oxygen and mayflies are struggling.' } }] }));
    const res = await handleNarrate({ facts, text: template }, ctx(f as unknown as typeof fetch));
    expect(res.status).toBe(200);
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://api.aimlapi.com/v1/chat/completions');
    expect(sent.model).toBe('amazon/nova-micro-v1');
    expect(sent.max_tokens).toBeLessThanOrEqual(120);
    expect(sent.messages[1].content).not.toContain('secret');
    expect(res.body).toEqual(expect.objectContaining({ model: 'amazon/nova-micro-v1' }));
  });

  it('rejects wording that invents numbers', async () => {
    const f = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'The water warmed by 12 °C and 40 mayflies died.' } }] }));
    const res = await handleNarrate({ facts, text: template }, ctx(f as unknown as typeof fetch));
    expect(res.status).toBe(502);
  });

  it('accepts only clean rewordings', () => {
    expect(acceptRewording('"Hot weather warmed the water by 6.6 °C, so oxygen dropped"', template)).toBe('Hot weather warmed the water by 6.6 °C, so oxygen dropped.');
    expect(acceptRewording('short', template)).toBeNull();
    expect(acceptRewording('Visit https://example.com for more about 6.6 °C water.', template)).toBeNull();
  });

  it('sanitizes facts', () => {
    expect(sanitizeFacts(null)).toBeNull();
    const s = sanitizeFacts(facts)!;
    expect(s).not.toHaveProperty('secret');
    expect(s.stressor).toBe('heatwave');
  });
});
