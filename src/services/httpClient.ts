type HttpOptions = RequestInit & {
  timeoutMs?: number;
};

export async function httpRequest(url: string, options: HttpOptions = {}): Promise<any> {
  const timeoutMs = Number(options.timeoutMs ?? 3000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (res.status === 402) {
      console.warn('[CLOUD OFFLINE] Mudando para modo local');
      return { degraded: true };
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  } catch {
    return { degraded: true };
  } finally {
    clearTimeout(timer);
  }
}

