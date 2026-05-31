import { observabilityConsole } from '../shared/logger/observabilityConsole';
export type SupabaseUrlTestResult = {
  ok: boolean;
  errorType?: 'dns' | 'timeout' | 'network';
  detail?: string;
};

function getErrorText(error: unknown): string {
  const e = error as any;
  return String(e?.message || e?.cause?.message || e || '').toLowerCase();
}

function classifyErrorType(error: unknown): 'dns' | 'timeout' | 'network' {
  const text = getErrorText(error);
  if (
    text.includes('err_name_not_resolved') ||
    text.includes('name_not_resolved') ||
    text.includes('dns')
  ) {
    return 'dns';
  }
  if (text.includes('aborted') || text.includes('aborterror') || text.includes('timeout')) {
    return 'timeout';
  }
  return 'network';
}

export async function checkDNS(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('timeout'), 10000);
    await fetch(`${url}/auth/v1/health`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    return classifyErrorType(error) !== 'dns';
  }
}

export async function testSupabaseUrl(url: string): Promise<SupabaseUrlTestResult> {
  const maxAttempts = 2;
  let delay = 500;
  let lastErrorType: 'dns' | 'timeout' | 'network' = 'network';
  let lastDetail = '';

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort('timeout'), 10000);
      // Endpoint de health de auth costuma responder mesmo sem sessão.
      const res = await fetch(`${url}/auth/v1/health`, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);
      if (res.ok || res.status === 401 || res.status === 404) {
        return { ok: true };
      }
      lastErrorType = 'network';
      lastDetail = `status:${res.status}`;
    } catch (error) {
      lastDetail = getErrorText(error);
      lastErrorType = classifyErrorType(error);
    }
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  observabilityConsole.error('[NETWORK] Supabase não acessível:', lastErrorType, lastDetail || '(sem detalhe)');
  return { ok: false, errorType: lastErrorType, detail: lastDetail };
}

