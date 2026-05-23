import { ApiError } from './apiClient';

type HttpOptions = RequestInit & {
  timeoutMs?: number;
};

export async function httpRequest(url: string, options: HttpOptions = {}): Promise<unknown> {
  const timeoutMs = Number(options.timeoutMs ?? 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text };
      }
    }
    if (!res.ok) {
      const msg =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new ApiError(msg, res.status, body);
    }
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e instanceof Error ? e.message : 'network_error', 0, null);
  } finally {
    clearTimeout(timer);
  }
}
