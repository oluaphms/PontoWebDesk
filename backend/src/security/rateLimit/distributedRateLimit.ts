import { logger } from '../../logger/logger.js';
import { getRateLimitProvider } from './redisProvider.js';

type MemoryEntry = {
  count: number;
  resetAt: number;
};

export type DistributedRateLimitInput = {
  key: string;
  maxRequests: number;
  windowMs: number;
};

export type DistributedRateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  distributed: boolean;
};

const memoryStore = new Map<string, MemoryEntry>();

let memoryFallbackLogged = false;

function logMemoryFallbackOnce(): void {
  if (memoryFallbackLogged) return;
  memoryFallbackLogged = true;
  logger.warn({
    module: 'security.rateLimit',
    action: 'RATE_LIMIT_MEMORY_FALLBACK',
    message:
      'Rate limiting distribuído (Redis/Upstash) indisponível — usando store in-memory. ' +
      'Configure REDIS_URL ou UPSTASH_* e RATE_LIMIT_REDIS_REQUIRED=true em produção.',
  });
}

export async function checkDistributedRateLimit(
  input: DistributedRateLimitInput,
): Promise<DistributedRateLimitResult> {
  const now = Date.now();
  const resetAt = now + input.windowMs;
  const provider = await getRateLimitProvider().catch(() => null);

  if (provider) {
    const windowSeconds = Math.max(1, Math.ceil(input.windowMs / 1000));
    const count = await provider.incrementWithExpiry(input.key, windowSeconds);
    return {
      allowed: count <= input.maxRequests,
      remaining: Math.max(0, input.maxRequests - count),
      resetAt,
      distributed: true,
    };
  }

  logMemoryFallbackOnce();

  const current = memoryStore.get(input.key);
  if (!current || now > current.resetAt) {
    memoryStore.set(input.key, { count: 1, resetAt });
    return { allowed: true, remaining: input.maxRequests - 1, resetAt, distributed: false };
  }
  if (current.count >= input.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt, distributed: false };
  }
  current.count += 1;
  return {
    allowed: true,
    remaining: input.maxRequests - current.count,
    resetAt: current.resetAt,
    distributed: false,
  };
}
