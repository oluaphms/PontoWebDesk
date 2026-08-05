/**
 * Avaliação agregada de risco operacional por empresa (alertas não resolvidos + SLA).
 */

export type OperationalSlaConfigRow = {
  id?: string;
  company_id?: string;
  max_pending_rep_minutes?: number | null;
  max_open_shift_minutes?: number | null;
  max_inconsistencies?: number | null;
  notify_email?: boolean | null;
  notify_whatsapp?: boolean | null;
};

export type CompanyRiskLevel = 'ok' | 'medium' | 'high' | 'critical';

export type CompanyRiskEvaluation = {
  risk: CompanyRiskLevel;
  total_alerts: number;
  critical: number;
  high: number;
  /** Limite aplicado para contagem `high` (vem do SLA ou default). */
  high_threshold: number;
  /** Limite de volume de alertas para classificar `medium` (default fixo até haver coluna dedicada). */
  medium_volume_threshold: number;
};

type AlertLike = { severity?: string | null };

const DEFAULT_HIGH_THRESHOLD = 3;
const DEFAULT_MEDIUM_VOLUME = 5;

/**
 * Regras: qualquer crítico → risco crítico; excesso de `high` → risco alto; volume total → médio.
 * `max_inconsistencies` no SLA reutilizado como limiar de alertas **high** (conforme especificação inicial).
 */
export function evaluateCompanyRisk({
  alerts,
  sla,
}: {
  alerts: AlertLike[];
  sla: OperationalSlaConfigRow | null;
}): CompanyRiskEvaluation {
  const list = Array.isArray(alerts) ? alerts : [];
  const critical = list.filter((a) => String(a?.severity ?? '').toLowerCase() === 'critical').length;
  const high = list.filter((a) => String(a?.severity ?? '').toLowerCase() === 'high').length;

  const highThresholdRaw = sla?.max_inconsistencies;
  const high_threshold =
    typeof highThresholdRaw === 'number' && Number.isFinite(highThresholdRaw) && highThresholdRaw >= 0
      ? highThresholdRaw
      : DEFAULT_HIGH_THRESHOLD;

  const medium_volume_threshold = DEFAULT_MEDIUM_VOLUME;

  let risk: CompanyRiskLevel = 'ok';

  if (critical > 0) risk = 'critical';
  else if (high > high_threshold) risk = 'high';
  else if (list.length > medium_volume_threshold) risk = 'medium';

  return {
    risk,
    total_alerts: list.length,
    critical,
    high,
    high_threshold,
    medium_volume_threshold,
  };
}
