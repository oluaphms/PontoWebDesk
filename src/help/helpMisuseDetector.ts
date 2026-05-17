import type { OperationalDiagnosticInput } from './helpDiagnosticEngine';
import type { HelpDocSlug } from './helpCenterCatalog';
import { getTopBehaviorRoutes } from './helpBehaviorTracker';

export interface MisuseWarning {
  id: string;
  severity: 'warning' | 'critical';
  message: string;
  recommendation: string;
  doc: HelpDocSlug;
  section?: string;
}

const MANUAL_EDIT_KEY = 'pontowebdesk:help_manual_edit_signals';

interface ManualEditSignals {
  count: number;
  windowStart: number;
}

function readManualSignals(): ManualEditSignals {
  if (typeof window === 'undefined') return { count: 0, windowStart: Date.now() };
  try {
    return JSON.parse(window.localStorage.getItem(MANUAL_EDIT_KEY) || '{}') as ManualEditSignals;
  } catch {
    return { count: 0, windowStart: Date.now() };
  }
}

/** Registrar ajuste manual no espelho (chamar de fluxos de edição quando disponível). */
export function recordManualTimesheetEdit(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const prev = readManualSignals();
  const dayMs = 24 * 60 * 60 * 1000;
  const windowStart = now - prev.windowStart > dayMs ? now : prev.windowStart;
  const count = now - prev.windowStart > dayMs ? 1 : prev.count + 1;
  window.localStorage.setItem(MANUAL_EDIT_KEY, JSON.stringify({ count, windowStart }));
}

/**
 * Detecta padrões de uso incorreto a partir do estado operacional e comportamento.
 */
export function detectOperationalMisuse(input: OperationalDiagnosticInput): MisuseWarning[] {
  const warnings: MisuseWarning[] = [];

  const alerts = input.alerts?.filter((a) => !a.resolved) ?? [];
  const critical = alerts.filter((a) => a.severity === 'critical' || a.alert_type === 'inconsistency');
  if (critical.length >= 3) {
    warnings.push({
      id: 'ignored-critical-alerts',
      severity: 'critical',
      message: 'Há vários alertas críticos sem resolução.',
      recommendation: 'Priorize a auditoria de jornada antes de fechar o período.',
      doc: 'auditoria-jornada',
      section: 'erros-comuns',
    });
  }

  const status = input.status ?? [];
  const inconsistent = status.filter((s) => s.status === 'inconsistent' || s.status === 'error');
  if (inconsistent.length >= 5) {
    warnings.push({
      id: 'many-inconsistencies',
      severity: 'warning',
      message: 'Muitas jornadas inconsistentes acumuladas.',
      recommendation: 'Revise escalas e REP antes de ajustes manuais em massa.',
      doc: 'jornada',
      section: 'erros-comuns',
    });
  }

  const manual = readManualSignals();
  if (manual.count >= 8) {
    warnings.push({
      id: 'frequent-manual-edits',
      severity: 'warning',
      message: 'Você está ajustando o ponto manualmente com frequência.',
      recommendation: 'Isso pode indicar problema no REP ou na escala — confira sincronização e cadastro.',
      doc: 'relogios-rep',
      section: 'boas-praticas',
    });
  }

  const topRoute = getTopBehaviorRoutes(1)[0];
  if (topRoute?.path === '/admin/timesheet' && topRoute.count >= 15 && inconsistent.length > 0) {
    warnings.push({
      id: 'timesheet-heavy-inconsistent',
      severity: 'warning',
      message: 'Uso intenso do espelho com inconsistências ativas.',
      recommendation: 'Evite editar período fechado; reabra o espelho somente se a política permitir.',
      doc: 'espelho-de-ponto',
      section: 'erros-comuns',
    });
  }

  if (input.risk?.risk === 'critical') {
    warnings.push({
      id: 'risk-critical',
      severity: 'critical',
      message: 'Risco operacional crítico detectado.',
      recommendation: 'Não avance o fechamento até zerar pendências.',
      doc: 'auditoria-jornada',
      section: 'como-usar',
    });
  }

  return warnings.slice(0, 4);
}
