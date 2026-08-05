// @vitest-environment node

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createLogPayload } from './logger.js';
import { requestContextMiddleware } from '../middleware/requestContext.js';
import { getRequestContext } from './logger.context.js';

describe('backend observability', () => {
  it('propaga requestId e correlationId pelo middleware', () => {
    const headers: Record<string, string> = {};
    const req = {
      method: 'GET',
      originalUrl: '/api/health',
      headers: {
        'x-request-id': 'req-from-client',
        'x-correlation-id': 'corr-from-client',
      },
    };
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
    });

    let observedContext = getRequestContext();
    requestContextMiddleware(req as never, res as never, () => {
      observedContext = getRequestContext();
    });

    expect(headers['x-request-id']).toBe('req-from-client');
    expect(headers['x-correlation-id']).toBe('corr-from-client');
    expect(observedContext?.requestId).toBe('req-from-client');
    expect(observedContext?.correlationId).toBe('corr-from-client');
  });

  it('gera payload com schema, redaction e erro serializado', () => {
    const payload = createLogPayload('error', {
      module: 'backend.observability.test',
      action: 'BACKEND_LOG_SCHEMA',
      message: 'erro estruturado',
      requestId: 'req-backend',
      correlationId: 'corr-backend',
      userId: 'user-1',
      companyId: 'company-1',
      error: new Error('falha com Bearer token-super-secreto'),
      meta: {
        password: 'senha-real',
        authorization: 'Bearer outro-token-super-secreto',
        email: 'user@example.com',
      },
    });

    for (const field of [
      'timestamp',
      'level',
      'service',
      'module',
      'action',
      'requestId',
      'correlationId',
      'userId',
      'companyId',
      'message',
      'error',
      'meta',
    ]) {
      expect(payload).toHaveProperty(field);
    }

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('senha-real');
    expect(serialized).not.toContain('token-super-secreto');
    expect(serialized).not.toContain('user@example.com');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[REDACTED_BEARER_TOKEN]');
  });
});
