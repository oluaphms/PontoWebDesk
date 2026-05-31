import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Fechamento de folha: consulta e enforce de “hard lock”.
 * Estado isolado deste módulo evita ciclo imports com timeRecords.service.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as supabaseRef } from './supabaseClient';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';

const SP_TZ = 'America/Sao_Paulo';

function getClient(): SupabaseClient | null {
  return supabaseRef as SupabaseClient | null;
}

/** Mes e ano civis da data LOCAL YYYY-MM-DD (sem TZ). Alinha fechamentos por dia do calendário. */
export function monthYearFromCivilYmd(dateYmd: string): { year: number; month: number } {
  const d = String(dateYmd || '').slice(0, 10);
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return { year: y, month: m };
}

/** Mês/ano civis em America/Sao_Paulo (alinhado a timesheet_is_closed_for_stamp no Postgres). */
export function monthYearFromIsoInSaoPaulo(isoUtcOrLocal: string): { year: number; month: number } | null {
  const s = String(isoUtcOrLocal || '').trim();
  if (!s) return null;
  let d: Date;
  try {
    d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
  } catch {
    return null;
  }
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: SP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const yy = Number(parts.find((p) => p.type === 'year')?.value);
  const mo = Number(parts.find((p) => p.type === 'month')?.value);
  if (!yy || mo < 1 || mo > 12) return null;
  return { year: yy, month: mo };
}

function isoRefOrNull(isoFallback: string | undefined | null): string | null {
  if (!isoFallback || !String(isoFallback).trim()) return null;
  const s = String(isoFallback).trim();
  if (Number.isNaN(new Date(s).getTime())) return null;
  return s;
}

/** Indica fechamento oficial para empresa/colaborador/mês civil. */
export async function isTimesheetClosed(
  companyId: string,
  month: number,
  year: number,
  employeeId?: string,
  clientOverride?: SupabaseClient | null,
): Promise<boolean> {
  const client = clientOverride ?? getClient();
  if (!client) return false;

  let query = client
    .from('timesheet_closures')
    .select('id')
    .eq('company_id', companyId)
    .eq('month', month)
    .eq('year', year);

  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return !!data;
}

/** Recálculo/UI: erro legível quando o dia cai em mês fechado (data civil local YYYY-MM-DD). */
export async function assertMonthOpenForEmployee(
  companyId: string,
  employeeId: string,
  dateIsoYmd: string,
): Promise<void> {
  const d = String(dateIsoYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  const { year: y, month: m } = monthYearFromCivilYmd(d);
  if (!y || !m) return;
  const closed = await isTimesheetClosed(companyId, m, y, employeeId);
  if (closed) {
    throw new Error(`PERIODO_FECHADO: período ${String(m).padStart(2, '0')}/${y}. Operação não permitida.`);
  }
}

async function isClosedForRef(
  companyId: string,
  employeeId: string,
  refIso: string,
  clientOverride?: SupabaseClient | null,
): Promise<boolean> {
  const cy = monthYearFromIsoInSaoPaulo(refIso);
  if (!cy?.year || !cy?.month) return false;
  return isTimesheetClosed(companyId, cy.month, cy.year, employeeId, clientOverride);
}

/**
 * Auditoria de tentativa bloqueada (espelho, importações, sincronização).
 * Nunca lança para não impedir fluxo síncrono.
 */
export async function logBlockedTimesheetMutation(params: {
  companyId: string;
  userId?: string | null;
  userName?: string | null;
  /** Campo principal `audit_logs.action` (ex.: INSERT_PUNCH, IMPORT_BLOCKED_CLOSED_PERIOD). */
  auditActionType: string;
  reason?: string;
  employeeId?: string;
  date?: string;
  refIso?: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  try {
    await LoggingService.log({
      severity: LogSeverity.SECURITY,
      action: params.auditActionType,
      userId: params.userId ?? undefined,
      userName: params.userName ?? undefined,
      companyId: params.companyId,
      details: {
        /** Metadados JSON (`audit_logs.details` — não confundir com coluna SQL). */
        blocked_classification: 'BLOCKED_ACTION',
        reason: params.reason ?? 'PERIODO_FECHADO',
        employeeId: params.employeeId,
        date: params.date,
        ref_iso: params.refIso,
        timestamp: new Date().toISOString(),
        ...(params.extra ?? {}),
      },
    });
  } catch (e) {
    observabilityConsole.warn('[timesheetClosure] falha ao gravar auditoria bloqueada', e);
  }
}

/** Lança Error('PERIODO_FECHADO') se o instante/ref for de mês fechado para o colaborador. */
export async function throwIfTimesheetClosedForPunchMutation(opts: {
  companyId: string;
  employeeId: string;
  /** ISO timestamps (created_at ou timestamp oficial). Preferir sempre que existir. */
  refIso?: string | null;
  /** YYYY-MM-DD civil do dia da batida (REP / correção por data literal). */
  civilYmd?: string | null;
  auditSource: string;
  auditAction:
    | 'INSERT_PUNCH'
    | 'UPDATE_PUNCH'
    | 'DELETE_PUNCH'
    | 'CLOCK_INGEST_PRECHECK'
    | 'IMPORT_BLOCKED_CLOSED_PERIOD';
  userId?: string | null;
  userName?: string | null;
  /** Em rotas servidor (service role): passar o mesmo client usado na escrita (evita singleton Vite). */
  client?: SupabaseClient | null;
}): Promise<void> {
  if (!opts.companyId || !opts.employeeId) return;

  let closed = false;
  let auditDate = opts.civilYmd?.slice(0, 10);
  let auditRef: string | undefined = isoRefOrNull(opts.refIso) ?? undefined;
  const cli = opts.client ?? null;

  const cyRaw = opts.civilYmd?.slice(0, 10);
  if (cyRaw && /^\d{4}-\d{2}-\d{2}$/.test(cyRaw)) {
    const { year, month } = monthYearFromCivilYmd(cyRaw);
    if (year && month) closed = await isTimesheetClosed(opts.companyId, month, year, opts.employeeId, cli);
  } else {
    const ref = isoRefOrNull(opts.refIso);
    if (!ref) return;
    closed = await isClosedForRef(opts.companyId, opts.employeeId, ref, cli);
    if (!auditDate) {
      const parts = monthYearFromIsoInSaoPaulo(ref);
      if (parts) {
        auditDate = `${parts.year}-${String(parts.month).padStart(2, '0')}-01`;
      }
    }
    auditRef = ref;
  }

  if (!closed) return;

  await logBlockedTimesheetMutation({
    companyId: opts.companyId,
    userId: opts.userId,
    userName: opts.userName,
    auditActionType: opts.auditAction,
    employeeId: opts.employeeId,
    date: auditDate,
    refIso: auditRef ?? undefined,
    extra: { source: opts.auditSource },
  });

  throw new Error('PERIODO_FECHADO');
}

/** Reabre mês oficial (snapshot + closure). Auditoria obrigatória no chamador recomendável. */
export async function reopenTimesheet(params: {
  companyId: string;
  employeeId: string;
  month: number;
  year: number;
  client?: SupabaseClient | null;
}): Promise<void> {
  const client = params.client ?? getClient();
  if (!client) throw new Error('Supabase não inicializado');
  const { companyId, employeeId, month, year } = params;

  await client
    .from('timesheet_snapshots')
    .delete()
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .eq('month', month)
    .eq('year', year);

  const { error } = await client
    .from('timesheet_closures')
    .delete()
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .eq('month', month)
    .eq('year', year);

  if (error) throw error;
}
