import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AiEnv } from './server/ai';

/**
 * Serves /api/* from the same handlers the production server uses, so the AI
 * features work with `npm run dev` and `npm run preview` when AIMLAPI_KEY is
 * set in .env. Without a key the app falls back to its rule-based features.
 */
function localApi(env: AiEnv): Plugin {
  const attach = (server: ViteDevServer | PreviewServer, load: () => Promise<typeof import('./server/ai')>) => {
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const match = (req.url ?? '').match(/^\/api\/(status|describe|check|narrate)(?:\?|$)/);
      if (!match) return next();
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      const mod = await load();
      const result = await mod.route(match[1], req.method ?? 'GET', raw, {
        env,
        fetch,
        ip: req.socket.remoteAddress ?? 'local',
      });
      res.statusCode = result.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result.body));
    });
  };
  return {
    name: 'aquaverse-local-api',
    configureServer(server) {
      attach(server, () => server.ssrLoadModule('/server/ai.ts') as Promise<typeof import('./server/ai')>);
    },
    configurePreviewServer(server) {
      attach(server, () => import('./server/ai'));
    },
  };
}

export default defineConfig(({ mode, isSsrBuild }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // The server bundle (npm run build:server) needs no copy of public/.
    publicDir: isSsrBuild ? false : 'public',
    plugins: [
      react(),
      localApi({
        AIMLAPI_KEY: env.AIMLAPI_KEY,
        AIMLAPI_NARRATOR_MODEL: env.AIMLAPI_NARRATOR_MODEL,
        AI_DAILY_CALL_LIMIT: env.AI_DAILY_CALL_LIMIT,
        AI_DISABLED: env.AI_DISABLED,
      }),
    ],
    worker: { format: 'es' },
    build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  };
});
