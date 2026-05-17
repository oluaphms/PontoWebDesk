/**
 * Motor de alertas operacionais (espelho + REP + status reconciliado).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeRepMirrorType } from '../rep-integration/repOperationalSequenceResolver';
import { generateOperationalTasks } from '../automation/operationalAutoActions';
import { evaluateCompanyRisk, type OperationalSlaConfigRow } from './operationalRiskEngine';
import { notifyIfCriticalRisk } from './operationalNotifier';

export type OperationalAlertType =
  | 'missing_exit'
  | 'long_break'
  | 'excess_hours'
  | 'inconsistency'
  | 'rep_pending_stale';

export type OperationalAlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export type MirrorRecordInput = {
  timestamp: string;
  type: string;
};

export type RepPendingInput = {
  data_hora: string;
  tipo_marcacao?: string | null;
};

export type GeneratedOperationalAlert = {
  type: OperationalAlertType;
  severity: OperationalAlertSeverity;
  message: string;
  metadata?: Record<string, unknown>;
};

/** Horas trabalhadas aproximadas: soma blocos entrada→saída (pausas ignoradas no cálculo bruto). */
export function calculateWorkedHours(records: MirrorRecordInput[]): number {
  const sorted = [...records]
    .map((r) => ({
      ms: Date.parse(r.timestamp),
      norm: normalizeRepMirrorType(r.type),
    }))
    .filter((x) => !Number.isNaN(x.ms) && x.norm !== 'other')
    .sort((a, b) => a.ms - b.ms);

  let totalMs = 0;
  let openEntrada: number | null = null;

  for (const ev of sorted) {
    if (ev.norm === 'entrada') {
      openEntrada = ev.ms;
    } else if (ev.norm === 'saida' && openEntrada !== null) {
      totalMs += ev.ms - openEntrada;
      openEntrada = null;
    }
  }

  return Math.round((totalMs / 3_600_000) * 100) / 100;
}

const LONG_BREAK_HOURS = 2;

/**
 * Regras de alerta alinhadas ao pipeline operacional (despesa para UI / notificações futuras).
 */
export function generateOperationalAlerts({
  records,
  repPending,
  status,
  date,
}: {
  records: MirrorRecordInput[];
  repPending: RepPendingInput[];
  status: string;
  date: string;
}): GeneratedOperationalAlert[] {
  const alerts: GeneratedOperationalAlert[] = [];

  const meaningful = [...records]
    .map((r) => ({
      ms: Date.parse(r.timestamp),
      norm: normalizeRepMirrorType(r.type),
    }))
    .filter((x) => !Number.isNaN(x.ms) && x.norm !== 'other')
    .sort((a, b) => a.ms - b.ms);

  // 1. Falta saída (jornada aberta: último evento entrada ou pausa sem fecho)
  if (meaningful.length > 0) {
    const last = meaningful[meaningful.length - 1];
    const specOdd = records.length % 2 !== 0;
    const openShift = last.norm === 'entrada' || last.norm === 'pausa';
    if (specOdd || openShift) {
      alerts.push({
        type: 'missing_exit',
        severity: 'high',
        message: 'Funcionário sem batida de saída ou jornada incompleta.',
        metadata: { date, lastType: last.norm, mirrorCount: records.length },
      });
    }
  }

  // Intervalo longo (pausa → retorno > limite)
  for (let i = 0; i < meaningful.length - 1; i++) {
    const cur = meaningful[i];
    const next = meaningful[i + 1];
    if (cur.norm === 'pausa' && next.norm === 'entrada') {
      const h = (next.ms - cur.ms) / 3_600_000;
      if (h > LONG_BREAK_HOURS) {
        alerts.push({
          type: 'long_break',
          severity: 'medium',
          message: `Intervalo prolongado (~${h.toFixed(1)}h acima de ${LONG_BREAK_HOURS}h).`,
          metadata: { date, breakHours: Math.round(h * 100) / 100 },
        });
        break;
      }
    }
  }

  // 2. REP pendente
  if (repPending.length > 0) {
    alerts.push({
      type: 'rep_pending_stale',
      severity: 'medium',
      message: 'Batidas REP ainda não processadas no espelho.',
      metadata: { date, repPendingCount: repPending.length },
    });
  }

  // 3. Inconsistência (crítico nos critérios de aceite)
  if (status === 'inconsistent') {
    alerts.push({
      type: 'inconsistency',
      severity: 'critical',
      message: 'Sequência de ponto inválida.',
      metadata: { date, status },
    });
  }

  // 4. Jornada excessiva
  const totalHours = calculateWorkedHours(records);
  if (totalHours > 10) {
    alerts.push({
      type: 'excess_hours',
      severity: 'medium',
      message: `Jornada acima do limite de referência (${totalHours}h).`,
      metadata: { date, totalHours },
    });
  }

  return alerts;
}

/**
 * Recalcula risco da empresa a partir de todos os alertas não resolvidos e dispara notificação se crítico.
 */
export async function evaluateAndNotifyCompanyOperationalRisk(
  supabase: SupabaseClient,
  companyId: string,
): Promise<void> {
  const company = companyId.trim();
  if (!company) return;

  const { data: alertsData, error: aErr } = await supabase
    .from('operational_alerts')
    .select('severity, alert_type')
    .eq('company_id', company)
    .eq('resolved', false);

  if (aErr) {
    console.error('[OPERATIONAL RISK] Falha ao ler alertas', { companyId: company, message: aErr.message });
    return;
  }

  const { data: slaRow, error: sErr } = await supabase
    .from('operational_sla_config')
    .select('id,company_id,max_pending_rep_minutes,max_open_shift_minutes,max_inconsistencies,notify_email,notify_whatsapp')
    .eq('company_id', company)
    .maybeSingle();

  if (sErr) {
    console.error('[OPERATIONAL RISK] Falha ao ler SLA', { companyId: company, message: sErr.message });
  }

  const sla = (slaRow ?? null) as OperationalSlaConfigRow | null;
  const result = evaluateCompanyRisk({ alerts: alertsData ?? [], sla });

  await notifyIfCriticalRisk({
    companyId: company,
    risk: result.risk,
    sla,
  });
}

/**
 * Substitui alertas do dia (idempotente): apaga anteriores e reinsere o conjunto gerado.
 */
export async function replaceOperationalAlertsForDay(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string,
  dateYmd: string,
  records: MirrorRecordInput[],
  repPending: RepPendingInput[],
  status: string,
): Promise<void> {
  const company = companyId.trim();
  const emp = employeeId.trim();
  const day = dateYmd.trim();
  if (!company || !emp || !day) return;

  const { error: delErr } = await supabase
    .from('operational_alerts')
    .delete()
    .eq('company_id', company)
    .eq('employee_id', emp)
    .eq('date', day);

  if (delErr) {
    console.error('[OPERATIONAL ALERTS DELETE FAILED]', {
      companyId: company,
      employeeId: emp,
      date: day,
      message: delErr.message,
    });
    return;
  }

  const alerts = generateOperationalAlerts({
    records,
    repPending,
    status,
    date: day,
  });

  if (alerts.length === 0) {
    console.log('[OPERATIONAL ALERTS SYNCED]', { companyId: company, employeeId: emp, date: day, count: 0 });
    await evaluateAndNotifyCompanyOperationalRisk(supabase, company);
    return;
  }

  const rows = alerts.map((a) => ({
    company_id: company,
    employee_id: emp,
    date: day,
    alert_type: a.type,
    severity: a.severity,
    message: a.message,
    metadata: a.metadata ?? {},
    resolved: false,
    resolved_at: null as string | null,
  }));

  const { error: insErr } = await supabase.from('operational_alerts').insert(rows);

  if (insErr) {
    console.error('[OPERATIONAL ALERTS INSERT FAILED]', {
      companyId: company,
      employeeId: emp,
      date: day,
      message: insErr.message,
    });
    return;
  }

  console.log('[OPERATIONAL ALERTS SYNCED]', {
    companyId: company,
    employeeId: emp,
    date: day,
    count: rows.length,
  });

  await generateOperationalTasks({ supabase, companyId: company, employeeId: emp, date: day, alerts });
  await evaluateAndNotifyCompanyOperationalRisk(supabase, company);
}
