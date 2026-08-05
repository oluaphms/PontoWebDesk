import { observabilityConsole } from '../../src/shared/logger/observabilityConsole.js';
/**
 * Resiliência das APIs operacionais (produção / Vercel): timeout, degraded, service role.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { noCache } from './cache.js';
import { getSupabaseConfig } from './getSupabaseConfig.js';

export const OPERATIONAL_QUERY_TIMEOUT_MS = 5000;
export const OPERATIONAL_QUERY_LIMIT = 100;

export const OPERATIONAL_CORE_TABLES = [
  'operational_day_status',
  'operational_alerts',
  'operational_tasks',
  'operational_sla_config',
  'operational_audit_log',
] as const;

export function createOperationalServiceClient(): SupabaseClient {
  const { url, serviceKey } = getSupabaseConfig();
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function withQueryTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  ms: number = OPERATIONAL_QUERY_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`QUERY_TIMEOUT:${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function logOperationalApiError(route: string, err: unknown): void {
  observabilityConsole.error('[API ERROR]', {
    route,
    message: (err as { message?: string } | null)?.message,
    stack: (err as { stack?: string } | null)?.stack,
  });
}

export function degradedListResponse(
  corsHeaders: HeadersInit,
  route: string,
  reason?: string,
): Response {
  if (reason) {
    observabilityConsole.warn('[API DEGRADED]', { route, reason });
  }
  return noCache(
    Response.json(
      {
        success: true,
        data: [],
        degraded: true,
        ...(reason ? { reason } : {}),
      },
      { status: 200, headers: corsHeaders },
    ),
  );
}

export function degradedObjectResponse(
  corsHeaders: HeadersInit,
  route: string,
  data: Record<string, unknown>,
  reason?: string,
): Response {
  if (reason) {
    observabilityConsole.warn('[API DEGRADED]', { route, reason });
  }
  return noCache(
    Response.json(
      {
        success: true,
        data,
        degraded: true,
        ...(reason ? { reason } : {}),
      },
      { status: 200, headers: corsHeaders },
    ),
  );
}

export function degradedMutationResponse(
  corsHeaders: HeadersInit,
  route: string,
  error: string,
  detail?: string,
): Response {
  observabilityConsole.warn('[API DEGRADED]', { route, error, detail });
  return noCache(
    Response.json(
      {
        success: false,
        error,
        degraded: true,
        ...(detail ? { detail } : {}),
      },
      { status: 200, headers: corsHeaders },
    ),
  );
}

export function isOperationalTimeoutError(err: unknown): boolean {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '');
  return msg.startsWith('QUERY_TIMEOUT:');
}

function isMissingTableError(err: unknown): boolean {
  const code = String((err as { code?: string } | null)?.code ?? '');
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '').toLowerCase();
  return (
    code === '42P01' ||
    msg.includes('does not exist') ||
    (msg.includes('relation') && msg.includes('not exist'))
  );
}

/** Probe leve: confirma que as tabelas core existem (evita 500 opaco em produção). */
export async function verifyOperationalCoreTables(supabase: SupabaseClient): Promise<{
  ok: boolean;
  missing: string[];
}> {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return { ok: true, missing: [] };
  }

  const missing: string[] = [];
  await Promise.all(
    OPERATIONAL_CORE_TABLES.map(async (table) => {
      try {
        const { error } = await withQueryTimeout(
          supabase.from(table).select('id').limit(1),
          `schema.${table}`,
          3000,
        );
        if (error && isMissingTableError(error)) {
          missing.push(table);
        }
      } catch (e) {
        if (isOperationalTimeoutError(e)) {
          return;
        }
        if (isMissingTableError(e)) {
          missing.push(table);
        }
      }
    }),
  );
  return { ok: missing.length === 0, missing };
}

export async function fetchUserNamesByIds(
  supabase: SupabaseClient,
  companyId: string,
  ids: string[],
): Promise<Record<string, string | null>> {
  if (ids.length === 0) return {};
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const { data, error } = await withQueryTimeout(
    supabase
      .from('users')
      .select('id,nome')
      .eq('company_id', companyId)
      .in('id', unique)
      .limit(Math.min(unique.length, OPERATIONAL_QUERY_LIMIT)),
    'users.names',
  );
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map((u: { id: string; nome: string | null }) => [u.id, u.nome ?? null]),
  );
}
