// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { securityHeadersMiddleware } from '../middlewares/securityHeaders.js';

function collectHeaders(): Record<string, string | number | string[]> {
  const headers: Record<string, string | number | string[]> = {};
  const res = {
    setHeader(name: string, value: string | number | string[]) {
      headers[name] = value;
    },
    removeHeader(name: string) {
      headers[name] = '';
    },
  } as Response;
  securityHeadersMiddleware({} as Request, res, (() => {}) as NextFunction);
  return headers;
}

describe('securityHeadersMiddleware', () => {
  it('aplica headers de endurecimento na API', () => {
    process.env.NODE_ENV = 'production';
    const headers = collectHeaders();

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-XSS-Protection']).toBe('1; mode=block');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(String(headers['Content-Security-Policy'])).toContain("default-src 'none'");
    expect(String(headers['Strict-Transport-Security'])).toContain('max-age=31536000');
  });
});
