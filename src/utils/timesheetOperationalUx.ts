/**
 * UX operacional: rótulos, badges e saúde do período (sem lógica de cálculo).
 */

import type { TimesheetProcessingStatus } from '../services/timesheetProcessingStatus';

/** Estado unificado para UI (processamento + replay). */
export type OperationalDisplayStatus =
  | TimesheetProcessingStatus
  | 'drift'
  | 'inconsistent';

const LABELS: Record<string, string> = {
  ok: 'Cálculo correto',
  fallback_schedule: 'Cálculo com jornada padrão',
  drift: 'Recalculado com nova regra',
  inconsistent: 'Divergência detectada',
  error: 'Erro no cálculo',
  protected: 'Registro protegido',
  skipped_invalid_employee: 'Referência inválida',
};

export function mapProcessingStatusToLabel(status: string): string {
  return LABELS[status] ?? `Estado: ${status}`;
}

const TOOLTIPS: Partial<Record<OperationalDisplayStatus, string>> = {
  ok: 'Cálculo correto. Totais alinhados ao motor e às regras vigentes no momento do processamento.',
  fallback_schedule:
    'Cálculo com jornada padrão ou contingência. A escala aplicada pode divergir da escala nominal.',
  drift:
    'Este registro foi calculado com motor ou regras anteriores; ao reproduzir com a versão atual o resultado pode diferir — é esperado após atualização.',
  inconsistent:
    'Divergência detectada: com as mesmas versões de motor e regras, o replay não confirma os valores persistidos. Investigue batidas e dados.',
  error: 'Erro no cálculo ou integridade. Verifique cadastro, batidas e logs.',
  protected: 'Registro protegido (manual, fechado ou bloqueado). O sistema não sobrescreve automaticamente.',
  skipped_invalid_employee: 'Integridade: vínculo colaborador/empresa inválido ou referência ausente.',
};

export function operationalStatusTooltip(status: OperationalDisplayStatus): string {
  return TOOLTIPS[status] ?? mapProcessingStatusToLabel(status);
}

export type BadgeVariant = 'green' | 'yellow' | 'blue' | 'red' | 'neutral';

export function operationalBadgeVariant(status: OperationalDisplayStatus): BadgeVariant {
  if (status === 'ok') return 'green';
  if (status === 'protected') return 'neutral';
  if (status === 'inconsistent' || status === 'error') return 'red';
  if (status === 'fallback_schedule' || status === 'skipped_invalid_employee') return 'yellow';
  if (status === 'drift') return 'blue';
  return 'neutral';
}

export function deriveOperationalDisplayStatus(row: {
  processing_status?: TimesheetProcessingStatus;
  replay_status?: 'ok' | 'inconsistent' | 'drift' | 'error';
  has_drift?: boolean;
}): OperationalDisplayStatus {
  const rs = row.replay_status;
  if (rs === 'inconsistent') return 'inconsistent';
  if (rs === 'error') return 'error';
  if (rs === 'drift' || row.has_drift) return 'drift';
  const ps = row.processing_status;
  if (ps === 'fallback_schedule') return 'fallback_schedule';
  if (ps === 'error') return 'error';
  if (ps === 'protected' || ps === 'skipped_invalid_employee') return ps;
  return 'ok';
}

export type PeriodHealthSummary = {
  total: number;
  pctReliable: number;
  pctFallback: number;
  pctDrift: number;
  pctError: number;
  pctInconsistent: number;
  /** Protegido / referência inválida — não entram nas quatro categorias principais. */
  pctOther: number;
};

/**
 * Agrega percentuais sobre dias com linha `timesheets_daily` no período.
 */
export function computePeriodHealthSummary(
  statuses: OperationalDisplayStatus[],
): PeriodHealthSummary {
  const total = statuses.length;
  if (total === 0) {
    return {
      total: 0,
      pctReliable: 0,
      pctFallback: 0,
      pctDrift: 0,
      pctError: 0,
      pctInconsistent: 0,
      pctOther: 0,
    };
  }
  let reliable = 0;
  let fallback = 0;
  let drift = 0;
  let err = 0;
  let inconsistent = 0;
  let other = 0;
  for (const s of statuses) {
    if (s === 'ok') reliable += 1;
    else if (s === 'fallback_schedule') fallback += 1;
    else if (s === 'drift') drift += 1;
    else if (s === 'error') err += 1;
    else if (s === 'inconsistent') inconsistent += 1;
    else if (s === 'protected' || s === 'skipped_invalid_employee') other += 1;
  }
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;
  return {
    total,
    pctReliable: pct(reliable),
    pctFallback: pct(fallback),
    pctDrift: pct(drift),
    pctError: pct(err),
    pctInconsistent: pct(inconsistent),
    pctOther: pct(other),
  };
}

export const DRIFT_ALERT_COPY =
  'Este cálculo foi feito com regras anteriores e pode ter mudado. Compare com o replay ou aguarde novo processamento após atualização.';

export function operationalBadgeClassName(variant: BadgeVariant): string {
  switch (variant) {
    case 'green':
      return 'bg-emerald-500 ring-2 ring-emerald-500/40';
    case 'yellow':
      return 'bg-amber-400 ring-2 ring-amber-400/50';
    case 'blue':
      return 'bg-sky-500 ring-2 ring-sky-500/40';
    case 'red':
      return 'bg-red-500 ring-2 ring-red-500/40';
    default:
      return 'bg-slate-400 ring-2 ring-slate-400/35';
  }
}
