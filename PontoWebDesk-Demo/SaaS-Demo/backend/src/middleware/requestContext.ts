import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { getRequestContext, runWithRequestContext } from '../logger/logger.context.js';
import { logger } from '../logger/logger.js';
import { recordHttpRequest } from '../observability/httpMetrics.js';

function resolveHeaderId(value: unknown): string | null {
  const v = String(value || '').trim();
  return v.length > 0 ? v : null;
}

function requestPath(originalUrl: string): string {
  return originalUrl.split('?', 1)[0] || '/';
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveHeaderId(req.headers['x-request-id']) || randomUUID();
  const correlationId = resolveHeaderId(req.headers['x-correlation-id']) || randomUUID();
  const startedAt = Date.now();
  const path = requestPath(req.originalUrl);

  res.setHeader('x-request-id', requestId);
  res.setHeader('x-correlation-id', correlationId);

  runWithRequestContext({ requestId, correlationId }, () => {
    logger.info({
      module: 'http.request',
      action: 'REQUEST_START',
      message: `${req.method} ${path}`,
      requestId,
      correlationId,
      meta: {
        method: req.method,
        path,
      },
    });

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const ctx = getRequestContext();
      recordHttpRequest({
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs,
        companyId: ctx?.companyId ?? null,
      });
      logger.info({
        module: 'http.request',
        action: 'REQUEST_END',
        message: `${req.method} ${path} -> ${res.statusCode}`,
        requestId,
        correlationId,
        companyId: ctx?.companyId ?? undefined,
        meta: {
          method: req.method,
          path,
          statusCode: res.statusCode,
          durationMs,
          companyId: ctx?.companyId ?? null,
        },
      });
    });

    next();
  });
}
