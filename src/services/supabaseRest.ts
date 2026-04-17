/**
 * Cliente REST mínimo para o agente (service role) — PostgREST.
 */

import { withRetry } from './retry';

export interface SupabaseRestConfig {
  url: string;
  serviceKey: string;
}

function headers(cfg: SupabaseRestConfig, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function restGet<T>(cfg: SupabaseRestConfig, path: string): Promise<T> {
  const base = cfg.url.replace(/\/$/, '');
  const res = await withRetry(async () => {
    const r = await fetch(`${base}/rest/v1/${path}`, {
      method: 'GET',
      headers: headers(cfg),
    });
    if (!r.ok) {
      const t = await r.text();
      const err = new Error(`GET ${path}: HTTP ${r.status} ${t.slice(0, 400)}`);
      (err as Error & { status?: number }).status = r.status;
      throw err;
    }
    return r;
  });
  return res.json() as Promise<T>;
}

export async function restPatch(cfg: SupabaseRestConfig, path: string, body: unknown): Promise<void> {
  const base = cfg.url.replace(/\/$/, '');
  await withRetry(async () => {
    const r = await fetch(`${base}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: headers(cfg, { Prefer: 'return=minimal' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      const err = new Error(`PATCH ${path}: HTTP ${r.status} ${t.slice(0, 400)}`);
      (err as Error & { status?: number }).status = r.status;
      throw err;
    }
  });
}

/** Invoca RPC PostgREST (ex.: rep_ingest_punch). */
export async function restRpc<T = unknown>(
  cfg: SupabaseRestConfig,
  rpcName: string,
  body: Record<string, unknown>
): Promise<T> {
  const base = cfg.url.replace(/\/$/, '');
  const path = `rpc/${rpcName}`;
  const res = await withRetry(async () => {
    const r = await fetch(`${base}/rest/v1/${path}`, {
      method: 'POST',
      headers: headers(cfg, { Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      const err = new Error(`RPC ${rpcName}: HTTP ${r.status} ${t.slice(0, 500)}`);
      (err as Error & { status?: number }).status = r.status;
      throw err;
    }
    return r;
  });
  const text = await res.text();
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function restPostBulk(
  cfg: SupabaseRestConfig,
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  const base = cfg.url.replace(/\/$/, '');
  await withRetry(async () => {
    const r = await fetch(`${base}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers(cfg, {
        Prefer: 'return=minimal,resolution=ignore-duplicates',
      }),
      body: JSON.stringify(rows),
    });
    if (!r.ok) {
      const t = await r.text();
      const err = new Error(`POST ${table}: HTTP ${r.status} ${t.slice(0, 400)}`);
      (err as Error & { status?: number }).status = r.status;
      throw err;
    }
  });
}
