import express from 'express';
import cors from 'cors';
import apiRouter from './routes/apiRouter.js';
import { buildCorsAllowList, resolveCorsOrigin } from './corsConfig.js';

export const app = express();

const corsAllowList = buildCorsAllowList();

app.use(
  cors({
    origin(origin, callback) {
      const resolved = resolveCorsOrigin(origin, corsAllowList);
      if (resolved === false) {
        console.warn('[CORS] Origin bloqueada:', origin);
        callback(null, false);
        return;
      }
      callback(null, resolved);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  }),
);

if (process.env.NODE_ENV !== 'test') {
  console.log('[CORS] Origens permitidas:', corsAllowList.join(', '));
}
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  console.log('[API]', req.method, req.originalUrl);
  next();
});

/** Health local (sem DB) — útil se o proxy expuser só /api. */
app.get('/health', (_req, res) => {
  res.json({ ok: true, hint: 'Use GET /api/health for database status' });
});

/** Todas as rotas públicas da API com prefixo /api. */
app.use('/api', apiRouter);

/**
 * Rotas legadas sem /api (ex.: proxy_pass errado ou cliente antigo).
 * Evita confusão com "Cannot POST /auth/login" genérico do Express.
 */
const legacyApiPaths = ['/auth', '/employees', '/punches', '/data'];
for (const prefix of legacyApiPaths) {
  app.use(prefix, (_req, res) => {
    res.status(404).json({
      ok: false,
      error: 'not_found',
      message: `Esta rota deve usar o prefixo /api. Ex.: POST /api${prefix}/...`,
    });
  });
}

app.get('/', (_req, res) => {
  res.status(404).json({
    ok: false,
    error: 'not_found',
    message: 'API PontoWebDesk — use paths under /api (ex.: GET /api/health)',
  });
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'not_found' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API_ERROR]', err);
  res.status(500).json({ ok: false, error: 'internal_error' });
});
