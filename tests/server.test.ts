import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetGuards } from '../api/_lib/handlers';
import { createAppServer, SECURITY_HEADERS } from '../server/index';

let root: string;
let base: string;
let close: () => void;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'aquaverse-dist-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>AquaVerse</title>');
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log("stream");');
  writeFileSync(join(tmpdir(), 'aquaverse-secret.txt'), 'outside');
  resetGuards();
  const server = createAppServer({ root, env: {} });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

afterAll(() => {
  close();
  rmSync(root, { recursive: true, force: true });
  rmSync(join(tmpdir(), 'aquaverse-secret.txt'), { force: true });
});

describe('server for Render (render.yaml)', () => {
  it('sends the same security headers as vercel.json', () => {
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const all = vercel.headers.find((h) => h.source === '/(.*)')!;
    expect(Object.fromEntries(all.headers.map((h) => [h.key, h.value]))).toEqual(SECURITY_HEADERS);
  });

  it('serves the app with its security headers', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('content-security-policy')).toBe(SECURITY_HEADERS['Content-Security-Policy']);
    expect(await res.text()).toContain('AquaVerse');
  });

  it('caches hashed assets for good and compresses text', async () => {
    const res = await fetch(`${base}/assets/app-abc123.js`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(await res.text()).toBe('console.log("stream");');
  });

  it('falls back to the app for page paths but not for missing files', async () => {
    expect((await fetch(`${base}/any/page`)).status).toBe(200);
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it('never serves files outside the site folder', async () => {
    for (const path of ['/..%2faquaverse-secret.txt', '/assets/..%2f..%2faquaverse-secret.txt', '/%2e%2e%2faquaverse-secret.txt']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await res.text()).not.toContain('outside');
    }
  });

  it('answers the health check and the AI status', async () => {
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok');
    const status = await fetch(`${base}/api/status`);
    expect(status.headers.get('cache-control')).toBe('no-store');
    expect(await status.json()).toMatchObject({ describe: false, narrate: false });
  });

  it('turns AI requests away cleanly without a key', async () => {
    const res = await fetch(`${base}/api/describe`, { method: 'POST', body: JSON.stringify({ text: 'Clear water, shady trees, lots of bugs.' }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai-unavailable' });
  });

  it('rejects oversized request bodies', async () => {
    const res = await fetch(`${base}/api/narrate`, { method: 'POST', body: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
  });

  it('rejects unknown API routes and writes to static files', async () => {
    expect((await fetch(`${base}/api/unknown`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});
