// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../logger/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../security/authCookies.js', () => ({
  getAuthCookie: vi.fn(() => 'session-jwt'),
}));

vi.mock('../security/csrfCookies.js', () => ({
  CSRF_HEADER_NAME: 'x-csrf-token',
  getCsrfCookie: vi.fn(() => 'csrf-abc'),
}));

import { getAuthCookie } from '../security/authCookies.js';
import { getCsrfCookie } from '../security/csrfCookies.js';
import { webSecurityMiddleware } from '../middlewares/webSecurity.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: unknown };
}

describe('webSecurityMiddleware', () => {
  beforeEach(() => {
    vi.mocked(getAuthCookie).mockReturnValue('session-jwt');
    vi.mocked(getCsrfCookie).mockReturnValue('csrf-abc');
    process.env.CORS_ALLOWED_ORIGINS = 'https://pontowebdesk.vercel.app';
  });

  it('ignora GET sem validar CSRF', () => {
    const req = {
      method: 'GET',
      path: '/api/data/users',
      originalUrl: '/api/data/users',
      headers: {},
    } as Request;
    const next = vi.fn();

    webSecurityMiddleware(req, mockRes(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('bloqueia POST com cookie de sessão e CSRF inválido', () => {
    const req = {
      method: 'POST',
      path: '/api/data/users',
      originalUrl: '/api/data/users',
      headers: {
        origin: 'https://pontowebdesk.vercel.app',
        cookie: 'pwd_auth=session',
      },
    } as Request;
    const res = mockRes();
    const next = vi.fn();

    webSecurityMiddleware(req, res, next as NextFunction);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'CSRF_INVALID' });
    expect(next).not.toHaveBeenCalled();
  });

  it('permite POST com cookie, Origin confiável e CSRF válido', () => {
    const req = {
      method: 'POST',
      path: '/api/data/users',
      originalUrl: '/api/data/users',
      headers: {
        origin: 'https://pontowebdesk.vercel.app',
        cookie: 'pwd_auth=session',
        'x-csrf-token': 'csrf-abc',
      },
    } as unknown as Request;
    const next = vi.fn();

    webSecurityMiddleware(req, mockRes(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('ignora mutações com Bearer (REP/dispositivos)', () => {
    const req = {
      method: 'POST',
      path: '/api/data/users',
      originalUrl: '/api/data/users',
      headers: {
        authorization: 'Bearer device-token',
        cookie: 'pwd_auth=session',
      },
    } as Request;
    const next = vi.fn();

    webSecurityMiddleware(req, mockRes(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('bloqueia Origin não confiável em mutação com cookie', () => {
    const req = {
      method: 'PATCH',
      path: '/api/data/users/1',
      originalUrl: '/api/data/users/1',
      headers: {
        origin: 'https://evil.example',
        cookie: 'pwd_auth=session',
        'x-csrf-token': 'csrf-abc',
      },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    webSecurityMiddleware(req, res, next as NextFunction);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN_ORIGIN' });
    expect(next).not.toHaveBeenCalled();
  });

  it('exige CSRF também para sessão Master por cookie', () => {
    vi.mocked(getAuthCookie).mockReturnValue(null);
    const req = {
      method: 'POST',
      path: '/api/master/tenants',
      originalUrl: '/api/master/tenants',
      headers: {
        origin: 'https://pontowebdesk.vercel.app',
        cookie: 'pwd_master_session=master-token',
      },
    } as Request;
    const res = mockRes();
    const next = vi.fn();

    webSecurityMiddleware(req, res, next as NextFunction);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'CSRF_INVALID' });
    expect(next).not.toHaveBeenCalled();
  });
});
