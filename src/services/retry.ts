/**
 * Retry com backoff exponencial para falhas de rede / 5xx.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const defaultShouldRetry = (error: unknown, _attempt: number): boolean => {
  if (error && typeof error === 'object' && 'status' in error) {
    const s = (error as { status?: number }).status;
    if (typeof s === 'number' && s === 429) return false;
    if (typeof s === 'number' && s === 403) return false;
    if (typeof s === 'number' && s >= 500) return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/fetch|network|ECONNRESET|ETIMEDOUT|timeout/i.test(msg)) return true;
  return true;
};

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 30_000);
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === maxAttempts || !shouldRetry(e, attempt)) {
        throw e;
      }
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, exp + jitter));
    }
  }
  throw lastErr;
}
