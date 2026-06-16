import type { Request } from 'express';
import type { AuthedRequest } from './authMiddleware.js';
import { rateLimit } from './rateLimit.js';

function authSubject(req: Request): string {
  const auth = (req as AuthedRequest).auth;
  return String(auth?.userId ?? auth?.sub ?? '').trim();
}

function repDeviceSubject(req: Request): string {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const fromBody = String(body.device_id ?? body.p_rep_device_id ?? '').trim();
  const fromParams = String((req.params as { deviceId?: string }).deviceId ?? '').trim();
  const fromQuery = String(req.query.device_id ?? '').trim();
  return fromBody || fromParams || fromQuery;
}

/** Leitura/escrita autenticada na API genérica /data. */
export const dataApiRateLimit = rateLimit({
  keyPrefix: 'api:data',
  maxRequests: 180,
  windowMs: 60_000,
  key: authSubject,
});

/** Rotas REP (agente + integração). */
export const repApiRateLimit = rateLimit({
  keyPrefix: 'api:rep',
  maxRequests: 120,
  windowMs: 60_000,
  key: (req) => repDeviceSubject(req) || authSubject(req),
});

/** Uploads autenticados. */
export const uploadApiRateLimit = rateLimit({
  keyPrefix: 'api:uploads',
  maxRequests: 40,
  windowMs: 60_000,
  key: authSubject,
});

/** CRUD /employees autenticado. */
export const employeesApiRateLimit = rateLimit({
  keyPrefix: 'api:employees',
  maxRequests: 90,
  windowMs: 60_000,
  key: authSubject,
});

/** Registro de ponto. */
export const punchesApiRateLimit = rateLimit({
  keyPrefix: 'api:punches',
  maxRequests: 60,
  windowMs: 60_000,
  key: authSubject,
});

/** Banco de horas. */
export const bankHoursApiRateLimit = rateLimit({
  keyPrefix: 'api:bank-hours',
  maxRequests: 90,
  windowMs: 60_000,
  key: authSubject,
});
