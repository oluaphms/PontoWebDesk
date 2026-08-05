import { createClient, type RedisClientType } from 'redis';

export type RateLimitProvider = {
  incrementWithExpiry: (key: string, windowSeconds: number) => Promise<number>;
};

let providerPromise: Promise<RateLimitProvider | null> | null = null;

function upstashProvider(): RateLimitProvider | null {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) return null;

  async function command(args: string[]): Promise<unknown> {
    const response = await fetch(url.replace(/\/+$/, ''), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error('UPSTASH_RATE_LIMIT_FAILED');
    const body = (await response.json()) as { result?: unknown };
    return body.result;
  }

  return {
    async incrementWithExpiry(key, windowSeconds) {
      const count = Number(await command(['INCR', key]));
      if (count === 1) await command(['EXPIRE', key, String(windowSeconds)]);
      return count;
    },
  };
}

async function redisUrlProvider(): Promise<RateLimitProvider | null> {
  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) return null;
  const client = createClient({ url }) as RedisClientType;
  client.on('error', () => undefined);
  await client.connect();
  return {
    async incrementWithExpiry(key, windowSeconds) {
      const count = Number(await client.sendCommand(['INCR', key]));
      if (count === 1) await client.sendCommand(['EXPIRE', key, String(windowSeconds)]);
      return count;
    },
  };
}

export async function getRateLimitProvider(): Promise<RateLimitProvider | null> {
  if (!providerPromise) {
    providerPromise = (async () => upstashProvider() ?? await redisUrlProvider())();
  }
  return providerPromise;
}
