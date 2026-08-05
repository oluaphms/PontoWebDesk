import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Auditoria append-only tipo AFD — hash SHA-256 obrigatório.
 * Falha ao inserir: log CRITICAL; não interrompe cálculo.
 */

import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { isGenericDataApiWriteAllowed } from '../services/api';

function stableStringify(obj: Record<string, unknown>): string {
  if (typeof obj !== 'object' || obj === null) return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = obj[k] as unknown;
  return JSON.stringify(sorted);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const subtle = typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : undefined;
  if (subtle && typeof subtle.digest === 'function') {
    const digest = await subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  observabilityConsole.error('[AUDIT CRITICAL] SHA-256 indisponível (crypto.subtle)');
  return '';
}

async function resolveValidAuditEmployeeId(employeeId: string, companyId: string): Promise<string | null> {
  const id = String(employeeId || '').trim();
  const cid = String(companyId || '').trim();
  if (!id || !cid) return null;

  try {
    const direct = (await db.select(
      'employees',
      [
        { column: 'company_id', operator: 'eq', value: cid },
        { column: 'id', operator: 'eq', value: id },
      ],
      { columns: 'id,email', limit: 1 },
    )) as Array<{ id?: string; email?: string | null }>;
    if (direct?.[0]?.id) return String(direct[0].id);

    const users = (await db.select(
      'users',
      [
        { column: 'company_id', operator: 'eq', value: cid },
        { column: 'id', operator: 'eq', value: id },
      ],
      { columns: 'id,email', limit: 1 },
    )) as Array<{ id?: string; email?: string | null }>;
    const email = String(users?.[0]?.email ?? '').trim().toLowerCase();
    if (!email) return null;

    const byEmail = (await db.select(
      'employees',
      [
        { column: 'company_id', operator: 'eq', value: cid },
        { column: 'email', operator: 'eq', value: email },
      ],
      { columns: 'id,email', limit: 1 },
    )) as Array<{ id?: string; email?: string | null }>;
    return byEmail?.[0]?.id ? String(byEmail[0].id) : null;
  } catch (err) {
    observabilityConsole.error('[AUDIT CRITICAL] resolução de employee_id falhou', err);
    return null;
  }
}

/** Grava uma linha; `employee_id`, `action` e `payload` são obrigatórios pela validação pré-insert. */
export async function appendAfdTimeEngineAudit(params: {
  employeeId: string;
  companyId: string;
  action: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (!isGenericDataApiWriteAllowed()) return;
  if (!params?.employeeId || !params.companyId || !params.action?.trim()) {
    observabilityConsole.error('[AUDIT CRITICAL] insert negado — employee_id, action ou company_id ausentes');
    return;
  }
  const p = params.payload ?? {};
  if (typeof p !== 'object') {
    observabilityConsole.error('[AUDIT CRITICAL] payload inválido');
    return;
  }
  const createdAt = new Date().toISOString();
  const canonical = stableStringify(p as Record<string, unknown>);
  const preimage = `${params.employeeId}|${params.action}|${canonical}|${createdAt}`;
  const hash = await sha256Hex(preimage);
  if (!hash) return;
  const auditEmployeeId = await resolveValidAuditEmployeeId(params.employeeId, params.companyId);
  if (!auditEmployeeId) {
    observabilityConsole.error('[AUDIT CRITICAL] time_engine_afd_audit ignorado — employee_id sem FK válida', {
      employee_id: params.employeeId,
      company_id: params.companyId,
    });
    return;
  }

  await db
    .insert('time_engine_afd_audit', {
      employee_id: auditEmployeeId,
      company_id: params.companyId,
      action: params.action,
      payload: p,
      hash,
      created_at: createdAt,
    })
    .catch((err: Error | { message?: string }) => {
      observabilityConsole.error('[AUDIT CRITICAL] time_engine_afd_audit insert falhou', err?.message ?? err);
    });

  observabilityConsole.log('[AUDIT]', { action: params.action, emp: auditEmployeeId.slice(0, 8), hash_preview: `${hash.slice(0, 12)}…` });
}
