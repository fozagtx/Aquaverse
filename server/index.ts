import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { MAX_BODY_BYTES, route, type AiEnv } from './ai';

/**
 * Production server, deployed on Render (see render.yaml). It serves the built
 * site from dist/ and the optional AI helpers under /api/, with a strict
 * content security policy and other security headers on every response.
 */

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);
const API = /^\/api\/(status|verify|describe|check|narrate)$/;

export interface ServerOptions {
  /** Folder with the built site. */
  root: string;
  env: AiEnv;
}

function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/** Reads a request body, or null once it is larger than the API accepts (the rest is drained, not kept). */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((done, fail) => {
    let chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) chunks = [];
      else chunks.push(chunk);
    });
    req.on('end', () => done(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

async function serveApi(name: string, req: IncomingMessage, res: ServerResponse, env: AiEnv): Promise<void> {
  const raw = req.method === 'POST' ? await readBody(req) : '';
  if (raw === null) return send(res, 413, JSON.stringify({ error: 'too-large' }), 'application/json');
  const result = await route(name, req.method ?? 'GET', raw, { env, fetch, ip: clientIp(req) });
  send(res, result.status, JSON.stringify(result.body), 'application/json');
}

/** The file a URL path names inside root, or null when it would leave root. */
function resolveInside(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = resolve(root, '.' + decoded);
  return file === root || file.startsWith(root + sep) ? file : null;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function serveStatic(pathname: string, req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let file = resolveInside(root, pathname === '/' ? '/index.html' : pathname);
  if (!file) return send(res, 400, 'Bad request');
  if (!(await isFile(file))) {
    // The app keeps its state in the hash, so any other page path gets the app itself.
    if (extname(pathname)) return send(res, 404, 'Not found');
    file = join(root, 'index.html');
  }
  const ext = extname(file);
  const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    // Built assets have content hashes in their names, so they never change.
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  if (req.method === 'HEAD') return void res.end();
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  (gzip ? stream.pipe(createGzip()) : stream).pipe(res);
}

export function createAppServer({ root, env }: ServerOptions): Server {
  const base = resolve(root);
  return createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      if (pathname === '/healthz') return send(res, 200, 'ok');
      const api = pathname.match(API);
      if (api) return await serveApi(api[1], req, res, env);
      if (pathname.startsWith('/api/')) return send(res, 404, JSON.stringify({ error: 'not-found' }), 'application/json');
      await serveStatic(pathname, req, res, base);
    } catch {
      if (!res.headersSent) send(res, 500, 'Server error');
      else res.destroy();
    }
  });
}

// Started directly (npm start), not imported by a test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../dist', import.meta.url));
  const port = Number(process.env.PORT) || 3000;
  createAppServer({ root, env: process.env as AiEnv }).listen(port, () => {
    console.log(`AquaVerse on http://localhost:${port} (AI helpers ${process.env.AIMLAPI_KEY ? 'on' : 'off'})`);
  });
}
