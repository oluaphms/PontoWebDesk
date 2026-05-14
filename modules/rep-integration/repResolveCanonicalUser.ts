/**
 * Resolve batida REP → users.id com a mesma ordem que o servidor: RPC tiered,
 * depois match fraco (últimos 8 / janelas) com candidato único.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeRepExtractedIdentifiersIntoRawData } from './repExtractBestIdentifier';
import { repPunchLogEffectivePisCanonForDiagnostics } from './repPunchPendingIdentity';
import type { RepWeakPisMatchUser } from './repWeakPisFallbackMatch';
import { tryRepUniqueWeakPisMatch } from './repWeakPisFallbackMatch';
import { repUsersSelectColListForServer } from './repUsersSelectServer';

export type RepCanonicalPunchInput = {
  company_id: string;
  pis?: string | null;
  cpf?: string | null;
  matricula?: string | null;
  raw_data?: Record<string, unknown> | null;
};

export type CanonicalIdentityResult = {
  userId: string | null;
  matchStrategy: string | null;
  canonicalPis: string | null;
  source: 'rpc' | 'weak' | 'none';
};

function parseRpcMatch(data: unknown): { userId: string; matchStrategy: string | null; pisPasep: string | null } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const uid = o.user_id;
  if (uid == null) return null;
  const userId = typeof uid === 'string' ? uid : String(uid);
  if (!userId) return null;
  return {
    userId,
    matchStrategy: o.match_strategy != null ? String(o.match_strategy) : null,
    pisPasep: o.pis_pasep != null ? String(o.pis_pasep) : null,
  };
}

type MatchRpcArgs = {
  p_company_id: string;
  p_pis: string | null;
  p_cpf: string | null;
  p_matricula: string | null;
  p_raw_data: Record<string, unknown>;
};

async function resolveCanonicalUserInner(
  punch: RepCanonicalPunchInput,
  options: {
    users?: readonly RepWeakPisMatchUser[] | null;
    matchRpc: (args: MatchRpcArgs) => Promise<unknown>;
  }
): Promise<CanonicalIdentityResult> {
  const companyId = String(punch.company_id ?? '').trim();
  if (!companyId) {
    return { userId: null, matchStrategy: null, canonicalPis: null, source: 'none' };
  }

  const rawPayload = mergeRepExtractedIdentifiersIntoRawData(
    punch.raw_data && typeof punch.raw_data === 'object' && !Array.isArray(punch.raw_data) ? punch.raw_data : {}
  );

  let data: unknown;
  try {
    data = await options.matchRpc({
      p_company_id: companyId,
      p_pis: punch.pis ?? null,
      p_cpf: punch.cpf ?? null,
      p_matricula: punch.matricula ?? null,
      p_raw_data: rawPayload,
    });
  } catch {
    data = null;
  }

  const m = parseRpcMatch(data);
  if (m?.userId) {
    return {
      userId: m.userId,
      matchStrategy: m.matchStrategy,
      canonicalPis: m.pisPasep,
      source: 'rpc',
    };
  }

  const users = options.users;
  if (users && users.length > 0) {
    const weak = tryRepUniqueWeakPisMatch({
      companyId,
      users,
      pis: punch.pis ?? null,
      cpf: punch.cpf ?? null,
      raw_data: rawPayload,
    });
    if (weak) {
      return {
        userId: weak.userId,
        matchStrategy: 'fallback',
        canonicalPis: weak.canonicalPis,
        source: 'weak',
      };
    }
  }

  return { userId: null, matchStrategy: null, canonicalPis: null, source: 'none' };
}

/**
 * 1) PIS exacto, CPF, nº identificador (via `rep_match_user_id_for_rep_punch_row` = tiered + blob único)
 * 2) Se falhar: últimas 8 / janelas com `tryRepUniqueWeakPisMatch` (requer `options.users` preenchida)
 */
export async function resolveCanonicalUser(
  supabase: SupabaseClient,
  punch: RepCanonicalPunchInput,
  options?: { users?: readonly RepWeakPisMatchUser[] }
): Promise<CanonicalIdentityResult> {
  return resolveCanonicalUserInner(punch, {
    users: options?.users,
    matchRpc: async (args) => {
      const { data, error } = await supabase.rpc('rep_match_user_id_for_rep_punch_row', args);
      if (error) return null;
      return data;
    },
  });
}

/**
 * Mesma lógica que `resolveCanonicalUser`, com RPC invocada por callback (ex.: `restRpc` no agente).
 */
export async function resolveCanonicalUserWithMatcher(
  punch: RepCanonicalPunchInput,
  options: {
    users?: readonly RepWeakPisMatchUser[] | null;
    matchRpc: (args: MatchRpcArgs) => Promise<unknown>;
  }
): Promise<CanonicalIdentityResult> {
  return resolveCanonicalUserInner(punch, options);
}

/** raw_data após match explícito – remove marcação de pendência e define `canonical_user_id`. */
export function applyResolvedIdentityToRaw(base: Record<string, unknown>, userId: string): Record<string, unknown> {
  const o = { ...base };
  delete o.unresolved;
  delete o.unresolved_reason;
  o.canonical_user_id = userId;
  return o;
}

/** Batida sem colaborador no cadastro – estado sempre explícito no JSON. */
export function applyUnresolvedIdentityToRaw(base: Record<string, unknown>): Record<string, unknown> {
  const o = { ...base };
  delete o.canonical_user_id;
  delete o.matched_user_id;
  delete o.match_strategy;
  o.unresolved = true;
  o.unresolved_reason = 'no_match';
  return o;
}

function antigoDocForLog(punch: { pis?: string | null; cpf?: string | null }, raw: Record<string, unknown>): string {
  const eff = repPunchLogEffectivePisCanonForDiagnostics({
    pis: punch.pis,
    cpf: punch.cpf,
    raw_data: raw,
  });
  if (eff) return eff;
  const p = (punch.pis ?? '').trim() || (punch.cpf ?? '').trim();
  return p || '—';
}

export type FixUnmatchedPunchesRow = {
  id: string;
  nsr: number | null;
  antigo_doc: string;
  novo_user_id: string;
};

/**
 * Atualiza em lote `rep_punch_logs` sem `resolved_user_id`, tentando `resolveCanonicalUser` outra vez.
 */
export async function fixUnmatchedPunches(
  supabase: SupabaseClient,
  companyId: string,
  options?: { repDeviceId?: string | null; limit?: number }
): Promise<{ updated: number; rows: FixUnmatchedPunchesRow[] }> {
  const limit = Math.min(Math.max(options?.limit ?? 500, 1), 5000);
  const cid = companyId.trim();

  let q = supabase
    .from('rep_punch_logs')
    .select('id, nsr, pis, cpf, matricula, raw_data')
    .eq('company_id', cid)
    .is('resolved_user_id', null)
    .eq('ignored', false)
    .limit(limit);

  if (options?.repDeviceId) {
    q = q.eq('rep_device_id', options.repDeviceId);
  }

  const { data: pending, error: fetchErr } = await q;
  if (fetchErr) throw fetchErr;
  if (!pending?.length) return { updated: 0, rows: [] };

  const cols = await repUsersSelectColListForServer(supabase, [
    'id',
    'pis_pasep',
    'pis',
    'cpf',
    'status',
    'invisivel',
    'demissao',
    'company_id',
  ]);
  const { data: wu, error: usersErr } = await supabase
    .from('users')
    .select(cols.join(','))
    .eq('company_id', cid)
    .limit(5000);
  if (usersErr) {
    console.error('[USERS QUERY ERROR]', usersErr);
    throw usersErr;
  }
  const users = (wu as unknown as RepWeakPisMatchUser[] | null) ?? [];

  const rows: FixUnmatchedPunchesRow[] = [];
  let updated = 0;

  for (const row of pending as Array<{
    id: string;
    nsr: number | null;
    pis: string | null;
    cpf: string | null;
    matricula: string | null;
    raw_data: unknown;
  }>) {
    const raw =
      row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
        ? { ...(row.raw_data as Record<string, unknown>) }
        : {};

    const resolved = await resolveCanonicalUser(
      supabase,
      {
        company_id: cid,
        pis: row.pis,
        cpf: row.cpf,
        matricula: row.matricula,
        raw_data: raw,
      },
      { users }
    );

    if (!resolved.userId) continue;

    const nextRaw = applyResolvedIdentityToRaw(raw, resolved.userId);

    const patch: Record<string, unknown> = {
      resolved_user_id: resolved.userId,
      raw_data: nextRaw,
    };

    if (resolved.source === 'weak' && resolved.canonicalPis) {
      patch.pis = resolved.canonicalPis;
      patch.cpf = resolved.canonicalPis;
    }

    const { error: upErr } = await supabase.from('rep_punch_logs').update(patch).eq('id', row.id).is('resolved_user_id', null);

    if (upErr) continue;

    updated += 1;
    const antigo_doc = antigoDocForLog(row, raw);
    if (typeof globalThis !== 'undefined' && globalThis.console) {
      globalThis.console.warn('[REP IDENTITY FIX]', {
        nsr: row.nsr,
        antigo_doc,
        novo_user_id: resolved.userId,
      });
    }
    rows.push({
      id: row.id,
      nsr: row.nsr,
      antigo_doc,
      novo_user_id: resolved.userId,
    });
  }

  return { updated, rows };
}

/** Lote padrão ao reprocessar `rep_punch_logs` após correcção de cadastro (PIS/CPF/crachá). */
export const REP_REPROCESS_IDENTITY_BATCH_DEFAULT = 200;

/**
 * Após actualizar PIS/CPF/matrícula de um colaborador: tenta de novo as batidas pendentes sem `resolved_user_id`.
 * Nível serviço (não é trigger SQL).
 */
export async function autoReprocessRepAfterEmployeeIdentityUpdate(
  supabase: SupabaseClient,
  companyId: string,
  options?: { limit?: number }
): Promise<{ total_fixed: number }> {
  const limit = options?.limit ?? REP_REPROCESS_IDENTITY_BATCH_DEFAULT;
  const { updated } = await fixUnmatchedPunches(supabase, companyId, { limit });
  if (typeof globalThis !== 'undefined' && globalThis.console) {
    globalThis.console.warn('[REP REPROCESS AUTO]', { total_fixed: updated });
  }
  return { total_fixed: updated };
}
