import { PUNCH_SOURCE_WEB, type PunchSource } from '../constants/punchSource';
import { throwIfTimesheetClosedForPunchMutation } from './timesheetClosure';
import { enqueueAndMaybeSyncWebPunch } from './punchOfflineQueue';

/** Payload de insert em `public.punches` (campos conforme o schema no Supabase). */
export type PunchInsert = Record<string, unknown> & { source?: PunchSource | string };

/**
 * Monta objeto só com colunas existentes em `public.punches` (`created_at` como instante oficial).
 * Rejeita colunas fantasmas vindas no spread (date, punch_at, etc.).
 */
export function punchesRowForInsert(punch: PunchInsert, forcedSource?: string): Record<string, unknown> {
  const p = punch as Record<string, unknown>;
  /** `sent_at` no schema é promoção ao espelho — não usar como horário da batida. */
  const coalesceInstant = (): string => {
    for (const k of ['created_at', 'timestamp', 'punch_at', 'occurred_at'] as const) {
      const v = p[k];
      if (typeof v !== 'string' || !String(v).trim()) continue;
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return new Date(t).toISOString();
    }
    return new Date().toISOString();
  };

  const src =
    typeof forcedSource === 'string' && forcedSource.trim()
      ? forcedSource.trim()
      : typeof p.source === 'string'
        ? p.source
        : PUNCH_SOURCE_WEB;
  const row: Record<string, unknown> = {
    employee_id: String(p.employee_id ?? '').trim(),
    company_id: String(p.company_id ?? '').trim(),
    type: String(p.type ?? 'batida').trim(),
    method: String(p.method ?? 'api').trim(),
    created_at: coalesceInstant(),
    source: src,
  };
  if (p.raw_data != null) row.raw_data = p.raw_data;
  if (p.device_id != null && String(p.device_id).trim() !== '') row.device_id = String(p.device_id).trim();
  if (p.location != null) row.location = p.location;
  const sent = p.sent_at;
  if (typeof sent === 'string' && sent.trim() && !Number.isNaN(Date.parse(sent))) {
    row.sent_at = sent;
  }
  if (typeof p.error_count === 'number' && Number.isFinite(p.error_count)) row.error_count = p.error_count;
  return row;
}

export async function sendPunch(_unused: unknown, punch: PunchInsert): Promise<void> {
  const row = punchesRowForInsert(punch);
  const employeeId = String(row.employee_id ?? '').trim();
  const companyId = String(row.company_id ?? '').trim();
  const refIso = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();

  await throwIfTimesheetClosedForPunchMutation({
    companyId,
    employeeId,
    refIso,
    auditSource: 'services/sendPunch.service',
    auditAction: 'INSERT_PUNCH',
    client: null,
  });
  await enqueueAndMaybeSyncWebPunch({
    userId: employeeId,
    companyId,
    type: String(row.type ?? 'entrada'),
    method: String(row.method ?? 'web'),
    source: String(row.source ?? PUNCH_SOURCE_WEB),
    latitude: null,
    longitude: null,
    accuracy: null,
  });
}
