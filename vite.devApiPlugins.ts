import { observabilityConsole } from './src/shared/logger/observabilityConsole';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { readConnectRequestBody } from './vite.connect';

/**
 * Plugins de DEV locais. API canônica = Express (:3000).
 * Sem handlers do diretório api/ (dual-stack removido).
 */
export function devApiPlugins(): Plugin[] {
  return [
    {
      name: 'jobs-api-dev',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = req.url?.split('?')[0] ?? '';
          const jobsPath =
            pathname === '/api/process-daily-time'
              ? '/api/jobs/process-daily-time'
              : pathname;
          if (!jobsPath.startsWith('/api/jobs')) {
            next();
            return;
          }
          try {
            const { default: handler } = await import('./dev/jobsDevEntry.ts');
            const host = (req.headers.host as string) || 'localhost:3010';
            const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
            const fullUrl = `http://${host}${jobsPath}${query}`;
            const jobsRequestBody = await readConnectRequestBody(req as IncomingMessage);
            const response = await handler.fetch(
              new Request(fullUrl, {
                method: req.method || 'GET',
                headers: req.headers as HeadersInit,
                ...(jobsRequestBody ? { body: jobsRequestBody } : {}),
              }),
            );
            res.statusCode = response.status;
            response.headers.forEach((value, key) => {
              if (key.toLowerCase() === 'transfer-encoding') return;
              res.setHeader(key, value);
            });
            const jobsBuf = Buffer.from(await response.arrayBuffer());
            res.end(jobsBuf);
          } catch (e) {
            observabilityConsole.error('[jobs-api-dev]', e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            const detail = e instanceof Error ? e.message : String(e);
            res.end(JSON.stringify({ error: 'Falha ao executar /api/jobs', details: detail }));
          }
        });
      },
    },
  ];
}
