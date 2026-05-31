import type { NextFunction, Request, Response } from 'express';
import { checkDistributedRateLimit } from '../security/rateLimit/distributedRateLimit.js';

type RateLimitOptions = {
  keyPrefix: string;
  maxRequests: number;
  windowMs: number;
  key?: (req: Request) => string;
};

function clientIp(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  if (realIp) return realIp;
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 128) || 'unknown';
}

export function rateLimit(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = normalizeKeyPart(clientIp(req));
    const subject = normalizeKeyPart(options.key?.(req) ?? '');
    const key = `${options.keyPrefix}:${ip}:${subject}`;
    let result;
    try {
      result = await checkDistributedRateLimit({
        key,
        maxRequests: options.maxRequests,
        windowMs: options.windowMs,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'RATE_LIMIT_REDIS_REQUIRED') {
        res.status(503).json({
          ok: false,
          error: 'rate_limit_unavailable',
          message: 'Rate limiting distribuído obrigatório não configurado.',
        });
        return;
      }
      throw error;
    }

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        ok: false,
        error: 'rate_limited',
        message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
        retryAfterSeconds,
      });
      return;
    }

    next();
  };
}
