import { getMaturityHistory, getMaturityHistoryLastDays } from './helpMaturityHistory';

export interface RegressionAlert {
  id: string;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  doc: string;
  section?: string;
}

export interface RegressionInput {
  currentScore: number;
  openAlertsCount: number;
  previousAlertsCount?: number;
}

/**
 * Detecta regressão operacional (queda de score ou aumento de alertas).
 */
export function detectOperationalRegression(input: RegressionInput): RegressionAlert | null {
  const history = getMaturityHistoryLastDays(14);
  if (history.length >= 2) {
    const prev = history[history.length - 2].score;
    const drop = prev - input.currentScore;
    if (drop > 10) {
      return {
        id: 'score-drop',
        severity: 'critical',
        title: 'Sua operação piorou nos últimos dias',
        detail: `O score caiu ${drop} pontos (de ${prev}% para ${input.currentScore}%).`,
        doc: 'auditoria-jornada',
        section: 'erros-comuns',
      };
    }
  }

  const all = getMaturityHistory();
  if (all.length >= 7) {
    const weekAgo = all[Math.max(0, all.length - 7)];
    const dropWeek = weekAgo.score - input.currentScore;
    if (dropWeek > 10) {
      return {
        id: 'score-drop-week',
        severity: 'warning',
        title: 'Queda de maturidade na última semana',
        detail: `De ${weekAgo.score}% para ${input.currentScore}% nos últimos 7 dias.`,
        doc: 'auditoria-jornada',
        section: 'como-usar',
      };
    }
  }

  const prevAlerts = input.previousAlertsCount ?? 0;
  if (input.openAlertsCount > prevAlerts + 3 && input.openAlertsCount >= 5) {
    return {
      id: 'alerts-spike',
      severity: 'warning',
      title: 'Aumento relevante de alertas operacionais',
      detail: `${input.openAlertsCount} alerta(s) em aberto — revise antes do fechamento.`,
      doc: 'auditoria-jornada',
      section: 'erros-comuns',
    };
  }

  return null;
}

const PREV_ALERTS_KEY = 'pontowebdesk:help_prev_alerts_count';

export function snapshotAlertsCount(count: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PREV_ALERTS_KEY, String(count));
}

export function getPreviousAlertsSnapshot(): number {
  if (typeof window === 'undefined') return 0;
  const n = parseInt(window.localStorage.getItem(PREV_ALERTS_KEY) || '0', 10);
  return Number.isFinite(n) ? n : 0;
}
