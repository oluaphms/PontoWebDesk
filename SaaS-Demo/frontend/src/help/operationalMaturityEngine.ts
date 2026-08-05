import type { OperationalAlertRow } from '../services/operationalAlerts.service';
import type { CompanyRiskApiPayload } from '../services/operationalRisk.service';
import type { OperationalDayStatusRow } from '../services/operationalStatus.service';
import type { OperationalTaskRow } from '../services/operationalTasks.service';
import type { HelpDocSlug } from './helpCenterCatalog';
import { analyzeOperationalState, type OperationalDiagnosticInput } from './helpDiagnosticEngine';

export type MaturityLevel = 'iniciante' | 'intermediario' | 'avancado';

export interface MaturityIssue {
  id: string;
  label: string;
  penalty: number;
  doc?: HelpDocSlug;
  section?: string;
}

export interface OperationalMaturityInput extends OperationalDiagnosticInput {
  onboardingProgressPercent?: number;
  dailyChecklistPercent?: number;
}

export interface OperationalMaturityResult {
  score: number;
  level: MaturityLevel;
  issues: MaturityIssue[];
  summary: string;
}

function levelFromScore(score: number): MaturityLevel {
  if (score >= 75) return 'avancado';
  if (score >= 45) return 'intermediario';
  return 'iniciante';
}

function summaryForLevel(level: MaturityLevel, score: number): string {
  if (level === 'avancado') return 'Sua operação está bem organizada. Mantenha a rotina diária.';
  if (level === 'intermediario') return 'Você ainda tem pontos críticos a resolver para estabilizar o fechamento.';
  return 'Há pendências importantes. Priorize cadastro, REP e auditoria de jornada.';
}

/**
 * Score 0–100 de maturidade operacional (local, sem IA).
 */
export function computeOperationalMaturity(input: OperationalMaturityInput): OperationalMaturityResult {
  let score = 100;
  const issues: MaturityIssue[] = [];

  const push = (issue: MaturityIssue) => {
    issues.push(issue);
    score = Math.max(0, score - issue.penalty);
  };

  if ((input.totalEmployees ?? 0) === 0) {
    push({
      id: 'no-employees',
      label: 'Nenhum colaborador cadastrado',
      penalty: 25,
      doc: 'colaboradores',
      section: 'como-usar',
    });
  }

  const onboarding = input.onboardingProgressPercent ?? 100;
  if (onboarding < 100) {
    const gap = 100 - onboarding;
    push({
      id: 'onboarding-incomplete',
      label: `Primeiros passos incompletos (${onboarding}%)`,
      penalty: Math.min(20, Math.round(gap / 5)),
      doc: 'empresa',
      section: 'como-usar',
    });
  }

  const checklist = input.dailyChecklistPercent ?? 0;
  if (checklist < 50) {
    push({
      id: 'daily-checklist-low',
      label: 'Rotina diária do RH pouco utilizada hoje',
      penalty: 8,
      doc: 'auditoria-jornada',
      section: 'boas-praticas',
    });
  }

  const alerts = input.alerts?.filter((a) => !a.resolved) ?? [];
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical' || a.alert_type === 'inconsistency');
  if (criticalAlerts.length > 0) {
    push({
      id: 'critical-alerts',
      label: `${criticalAlerts.length} alerta(s) crítico(s) em aberto`,
      penalty: Math.min(30, criticalAlerts.length * 6),
      doc: 'auditoria-jornada',
      section: 'erros-comuns',
    });
  } else if (alerts.length > 0) {
    push({
      id: 'open-alerts',
      label: `${alerts.length} alerta(s) operacional(is) pendente(s)`,
      penalty: Math.min(18, alerts.length * 3),
      doc: 'auditoria-jornada',
      section: 'como-usar',
    });
  }

  const status = input.status ?? [];
  const inconsistent = status.filter((s) => s.status === 'inconsistent' || s.status === 'error');
  if (inconsistent.length > 0) {
    push({
      id: 'status-inconsistent',
      label: `${inconsistent.length} jornada(s) inconsistente(s) ou com erro`,
      penalty: Math.min(22, inconsistent.length * 4),
      doc: 'auditoria-jornada',
      section: 'erros-comuns',
    });
  }

  const pendingRep = status.filter((s) => s.status === 'pending_rep' || (s.total_rep_pending ?? 0) > 0);
  if (pendingRep.length > 0) {
    push({
      id: 'rep-pending',
      label: `REP pendente em ${pendingRep.length} colaborador(es)`,
      penalty: Math.min(20, pendingRep.length * 5),
      doc: 'relogios-rep',
      section: 'erros-comuns',
    });
  }

  const openTasks = (input.tasks ?? []).filter((t) => t.status !== 'resolved' && t.status !== 'done');
  if (openTasks.length > 0) {
    push({
      id: 'tasks-open',
      label: `${openTasks.length} tarefa(s) operacional(is) em aberto`,
      penalty: Math.min(12, openTasks.length * 2),
      doc: 'jornada',
      section: 'boas-praticas',
    });
  }

  if (input.risk && input.risk.risk !== 'ok') {
    const penalty =
      input.risk.risk === 'critical' ? 28 : input.risk.risk === 'high' ? 18 : input.risk.risk === 'medium' ? 10 : 0;
    if (penalty > 0) {
      push({
        id: `risk-${input.risk.risk}`,
        label: `Risco operacional ${input.risk.risk}`,
        penalty,
        doc: 'auditoria-jornada',
        section: 'como-usar',
      });
    }
  }

  const diagnostics = analyzeOperationalState(input);
  for (const d of diagnostics) {
    if (issues.some((i) => i.id === d.id)) continue;
    if (d.severity === 'info') continue;
    push({
      id: d.id,
      label: d.problem,
      penalty: d.severity === 'critical' ? 8 : 4,
      doc: d.solutionDoc,
      section: d.section,
    });
  }

  score = Math.round(Math.max(0, Math.min(100, score)));
  const level = levelFromScore(score);

  return {
    score,
    level,
    issues: issues.slice(0, 8),
    summary: summaryForLevel(level, score),
  };
}

/** Emoji de nível para UI */
export function maturityLevelEmoji(level: MaturityLevel): string {
  if (level === 'avancado') return '🟢';
  if (level === 'intermediario') return '🟡';
  return '🔴';
}

export function maturityLevelLabel(level: MaturityLevel): string {
  const map: Record<MaturityLevel, string> = {
    iniciante: 'Iniciante',
    intermediario: 'Intermediário',
    avancado: 'Avançado',
  };
  return map[level];
}
