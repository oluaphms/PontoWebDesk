import express from 'express';
import cors from 'cors';
import apiRouter from './routes/apiRouter.js';
import { buildCorsAllowList, resolveCorsOrigin } from './corsConfig.js';
import { logger } from './logger/logger.js';
import { requestContextMiddleware } from './middleware/requestContext.js';
import { securityHeadersMiddleware } from './middlewares/securityHeaders.js';
import { webSecurityMiddleware } from './middlewares/webSecurity.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

const corsAllowList = buildCorsAllowList();

app.use(securityHeadersMiddleware);

app.use(
  cors({
    origin(origin, callback) {
      const resolved = resolveCorsOrigin(origin, corsAllowList);
      if (resolved === false) {
        logger.warn({
          module: 'http.cors',
          action: 'CORS_ORIGIN_BLOCKED',
          message: 'Origin bloqueada por CORS',
          meta: { origin: origin || null },
        });
        callback(null, false);
        return;
      }
      callback(null, resolved);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Correlation-Id',
      'x-correlation-id',
      'X-CSRF-Token',
      'x-csrf-token',
    ],
  }),
);

app.use(webSecurityMiddleware);

if (process.env.NODE_ENV !== 'test') {
  logger.info({
    module: 'http.cors',
    action: 'CORS_ALLOWLIST_LOADED',
    message: 'Origens permitidas carregadas',
    meta: { origins: corsAllowList },
  });
}
/** Rotas com JSON grande usam parser dedicado no router (ex.: upload 7mb). */
const SKIP_JSON_PARSER_PATHS = new Set(['/api/uploads/photo', '/api/uploads/photo-url']);

app.use((req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (req.path === '/api/rep/import-afd' && ct.includes('multipart/form-data')) {
    next();
    return;
  }
  if (SKIP_JSON_PARSER_PATHS.has(req.path)) {
    next();
    return;
  }
  const limit = req.path === '/api/rep/import-afd' ? '12mb' : '1mb';
  express.json({ limit })(req, res, next);
});
app.use(requestContextMiddleware);

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
const legacyApiPaths = ['/auth', '/employees', '/punches', '/rep', '/data'];
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

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const payloadTooLarge =
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.too.large';

  if (payloadTooLarge) {
    logger.warn({
      module: 'http.app',
      action: 'PAYLOAD_TOO_LARGE',
      message: 'Corpo da requisição excede o limite configurado',
      meta: {
        method: req.method,
        path: req.originalUrl,
        contentLength: req.headers['content-length'] ?? null,
      },
    });
    res.status(413).json({ ok: false, error: 'payload_too_large' });
    return;
  }

  logger.error({
    module: 'http.app',
    action: 'UNHANDLED_ERROR',
    message: 'Erro não tratado na API',
    error: err,
    meta: {
      method: req.method,
      path: req.originalUrl,
    },
  });
  res.status(500).json({ ok: false, error: 'internal_error' });
});
