import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { readConnectRequestBody } from './vite.connect';

/** Middlewares locais que importam api/* (Supabase legado). Carregado só via `vite` — nunca no `vite build`. */
export function devApiPlugins(): Plugin[] {
  return [
    {
      name: 'reverse-geocode-api-dev',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = req.url?.split('?')[0] ?? '';
          if (pathname !== '/api/reverse-geocode') {
            next();
            return;
          }
          try {
            const { default: mod } = await import('./api/reverse-geocode.ts');
            const host = (req.headers.host as string) || 'localhost:3010';
            const fullUrl = `http://${host}${req.url ?? ''}`;
            const response = await mod.fetch(
              new Request(fullUrl, { method: req.method || 'GET', headers: req.headers as HeadersInit })
            );
            res.statusCode = response.status;
            response.headers.forEach((value, key) => {
              if (key.toLowerCase() === 'transfer-encoding') return;
              res.setHeader(key, value);
            });
            const body = Buffer.from(await response.arrayBuffer());
            res.end(body);
          } catch (e) {
            console.error('[reverse-geocode-api-dev]', e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Falha ao carregar handler da API' }));
          }
        });
      },
    },

    {
      name: 'jobs-api-dev',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = req.url?.split('?')[0] ?? '';
          if (!pathname.startsWith('/api/jobs')) {
            next();
            return;
          }
          try {
            const { default: handler } = await import('./dev/jobsDevEntry.ts');
            const host = (req.headers.host as string) || 'localhost:3010';
            const fullUrl = `http://${host}${req.url ?? ''}`;
            const jobsRequestBody = await readConnectRequestBody(req as IncomingMessage);
            const response = await handler(
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
            console.error('[jobs-api-dev]', e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            const detail = e instanceof Error ? e.message : String(e);
            res.end(JSON.stringify({ error: 'Falha ao executar /api/jobs', details: detail }));
          }
        });
      },
    },

    {
      name: 'rep-bridge-api-dev',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = req.url?.split('?')[0] ?? '';
          if (!pathname.startsWith('/api/rep/')) {
            next();
            return;
          }
          try {
            const { default: mod } = await import('./api/rep/[[...slug]].ts');
            const host = (req.headers.host as string) || 'localhost:3010';
            const fullUrl = `http://${host}${req.url ?? ''}`;
            const repRequestBody = await readConnectRequestBody(req as IncomingMessage);
            const response = await mod.fetch(
              new Request(fullUrl, {
                method: req.method || 'GET',
                headers: req.headers as HeadersInit,
                ...(repRequestBody ? { body: repRequestBody } : {}),
              })
            );
            res.statusCode = response.status;
            response.headers.forEach((value, key) => {
              if (key.toLowerCase() === 'transfer-encoding') return;
              res.setHeader(key, value);
            });
            const repResponseBuf = Buffer.from(await response.arrayBuffer());
            res.end(repResponseBuf);
          } catch (e) {
            console.error('[rep-bridge-api-dev]', e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            const detail = e instanceof Error ? e.message : String(e);
            res.end(
              JSON.stringify({
                error: 'Falha ao executar handler REP',
                details: detail,
              })
            );
          }
        });
      },
    },

    {
      name: 'rep-punch-api-dev',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = req.url?.split('?')[0] ?? '';
          const host = (req.headers.host as string) || 'localhost:3010';
          const run = async (handler: (r: Request) => Promise<Response>, pathAndQuery: string) => {
            const pq = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
            const fullUrl = `http://${host}${pq.split('#')[0]}`;
            const requestBody = await readConnectRequestBody(req as IncomingMessage);
            return handler(
              new Request(fullUrl, {
                method: req.method || 'GET',
                headers: req.headers as HeadersInit,
                ...(requestBody ? { body: requestBody } : {}),
              }),
            );
          };
          try {
            let response: Response;
            if (pathname === '/api/rep-punch') {
              const { handleRepPunchRpcLite } = await import('./api/_shared/repPunchRpcLite.ts');
              response = await run(handleRepPunchRpcLite, req.url ?? pathname);
            } else if (pathname === '/api/web-punches') {
              const { handleWebPunchesBatch } = await import('./api/_shared/webPunchesBatchHttp.ts');
              response = await run(handleWebPunchesBatch, req.url ?? pathname);
            } else if (pathname.startsWith('/api/operational')) {
              const { dispatchOperationalRequest } = await import('./api/_shared/operationalApiDispatch.ts');
              const requestBody = await readConnectRequestBody(req as IncomingMessage);
              const raw = req.url ?? pathname;
              const pq = raw.startsWith('/') ? raw : `/${raw}`;
              const fullUrl = `http://${host}${pq.split('#')[0]}`;
              response = await dispatchOperationalRequest(
                new Request(fullUrl, {
                  method: req.method || 'GET',
                  headers: req.headers as HeadersInit,
                  ...(requestBody ? { body: requestBody } : {}),
                }),
              );
              if (!response) {
                next();
                return;
              }
            } else if (pathname.startsWith('/api/lgpd')) {
              const { dispatchLgpdRequest } = await import('./api/_shared/lgpdApiHandler.ts');
              response = await run(dispatchLgpdRequest, req.url ?? pathname);
            } else if (pathname.startsWith('/api/auth')) {
              const { dispatchAuthRequest } = await import('./api/_shared/authApiDispatch.ts');
              const requestBody = await readConnectRequestBody(req as IncomingMessage);
              const raw = req.url ?? pathname;
              const pq = raw.startsWith('/') ? raw : `/${raw}`;
              const fullUrl = `http://${host}${pq.split('#')[0]}`;
              response = await dispatchAuthRequest(
                new Request(fullUrl, {
                  method: req.method || 'GET',
                  headers: req.headers as HeadersInit,
                  ...(requestBody ? { body: requestBody } : {}),
                }),
              );
              if (!response) {
                next();
                return;
              }
            } else if (pathname === '/api/test-supabase') {
              const { default: bridgeMod } = await import('./api/rep/[[...slug]].ts');
              const raw = req.url ?? pathname;
              const extra = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
              const bridgePath = `/api/rep/diagnostic-supabase${extra ? `?${extra}` : ''}`;
              response = await run((r) => bridgeMod.fetch(r), bridgePath);
            } else if (pathname === '/api/mirror-insert-time-record') {
              const { handleMirrorInsertTimeRecord } = await import('./api/_shared/mirrorInsertTimeRecord.ts');
              response = await run(handleMirrorInsertTimeRecord, req.url ?? pathname);
            } else {
              next();
              return;
            }
            res.statusCode = response.status;
            response.headers.forEach((value, key) => {
              if (key.toLowerCase() === 'transfer-encoding') return;
              res.setHeader(key, value);
            });
            const buf = Buffer.from(await response.arrayBuffer());
            res.end(buf);
          } catch (e) {
            console.error('[rep-punch-api-dev]', pathname, e);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            const detail = e instanceof Error ? e.message : String(e);
            res.end(JSON.stringify({ error: 'Falha ao executar handler da API', details: detail }));
          }
        });
      },
    },
  ];
}
