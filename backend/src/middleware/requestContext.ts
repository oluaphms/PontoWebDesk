import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '../logger/logger.context.js';
import { logger } from '../logger/logger.js';

function resolveHeaderId(value: unknown): string | null {
  const v = String(value || '').trim();
  return v.length > 0 ? v : null;
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveHeaderId(req.headers['x-request-id']) || randomUUID();
  const correlationId = resolveHeaderId(req.headers['x-correlation-id']) || randomUUID();
  const startedAt = Date.now();

  res.setHeader('x-request-id', requestId);
  res.setHeader('x-correlation-id', correlationId);

  runWithRequestContext({ requestId, correlationId }, () => {
    logger.info({
      module: 'http.request',
      action: 'REQUEST_START',
      message: `${req.method} ${req.originalUrl}`,
      requestId,
      correlationId,
      meta: {
        method: req.method,
        path: req.originalUrl,
      },
    });

    res.on('finish', () => {
      logger.info({
        module: 'http.request',
        action: 'REQUEST_END',
        message: `${req.method} ${req.originalUrl} -> ${res.statusCode}`,
        requestId,
        correlationId,
        meta: {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        },
      });
    });

    next();
  });
}
