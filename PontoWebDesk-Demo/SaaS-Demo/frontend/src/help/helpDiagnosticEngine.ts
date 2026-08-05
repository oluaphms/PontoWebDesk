import type { OperationalAlertRow } from '../services/operationalAlerts.service';
import type { CompanyRiskApiPayload } from '../services/operationalRisk.service';
import type { OperationalDayStatusRow } from '../services/operationalStatus.service';
import type { OperationalTaskRow } from '../services/operationalTasks.service';
import type { HelpDocSlug } from './helpCenterCatalog';
import type { HelpInsight } from './helpInsightsEngine';

export type DiagnosticSeverity = 'critical' | 'warning' | 'info';

export interface OperationalDiagnosticItem {
  id: string;
  severity: DiagnosticSeverity;
  problem: string;
  impact: string;
  solutionDoc: HelpDocSlug;
  section?: string;
  count?: number;
}

export interface OperationalDiagnosticInput {
  alerts?: OperationalAlertRow[];
  status?: OperationalDayStatusRow[];
  tasks?: OperationalTaskRow[];
  risk?: CompanyRiskApiPayload | null;
  insights?: HelpInsight[];
  totalEmployees?: number;
}

const ALERT_DOC: Record<string, { doc: HelpDocSlug; section?: string; impact: string }> = {
  missing_exit: {
    doc: 'espelho-de-ponto',
    section: 'erros-comuns',
    impact: 'Dia incompleto no espelho e risco de desconto indevido',
  },
  long_break: {
    doc: 'jornada',
    section: 'regras-importantes',
    impact: 'Intervalo acima do permitido pode gerar inconsistência',
  },
  excess_hours: {
    doc: 'calculos',
    section: 'erros-comuns',
    impact: 'Horas extras podem ir para folha ou banco incorretamente',
  },
  inconsistency: {
    doc: 'auditoria-jornada',
    section: 'erros-comuns',
    impact: 'Fechamento do mês pode ser bloqueado',
  },
  rep_pending_stale: {
    doc: 'relogios-rep',
    section: 'erros-comuns',
    impact: 'Batidas não entram no espelho oficial',
  },
};

function severityFromRisk(risk?: CompanyRiskApiPayload['risk']): DiagnosticSeverity {
  if (risk === 'critical') return 'critical';
  if (risk === 'high') return 'warning';
  if (risk === 'medium') return 'warning';
  return 'info';
}

/**
 * Analisa estado operacional e produz diagnósticos acionáveis com link para documentação.
 */
export function analyzeOperationalState(input: OperationalDiagnosticInput): OperationalDiagnosticItem[] {
  const items: OperationalDiagnosticItem[] = [];
  const seen = new Set<string>();

  const push = (item: OperationalDiagnosticItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };

  if ((input.totalEmployees ?? 0) === 0) {
    push({
      id: 'no-employees',
      severity: 'info',
      problem: 'Nenhum colaborador cadastrado',
      impact: 'O sistema de ponto não pode operar sem cadastro base',
      solutionDoc: 'colaboradores',
      section: 'como-usar',
    });
  }

  if (input.risk && input.risk.risk !== 'ok') {
    push({
      id: `risk-${input.risk.risk}`,
      severity: severityFromRisk(input.risk.risk),
      problem: `Risco operacional ${input.risk.risk === 'critical' ? 'crítico' : input.risk.risk === 'high' ? 'alto' : 'médio'}`,
      impact: `${input.risk.total_alerts} alerta(s) aberto(s) — ${input.risk.critical} crítico(s), ${input.risk.high} alto(s)`,
      solutionDoc: 'auditoria-jornada',
      section: 'como-usar',
      count: input.risk.total_alerts,
    });
  }

  const alerts = input.alerts?.filter((a) => !a.resolved) ?? [];
  const byType = new Map<string, number>();
  for (const a of alerts) {
    byType.set(a.alert_type, (byType.get(a.alert_type) ?? 0) + 1);
  }

  for (const [type, count] of byType) {
    const meta = ALERT_DOC[type];
    if (!meta) continue;
    push({
      id: `alert-${type}`,
      severity: type === 'rep_pending_stale' || type === 'inconsistency' ? 'critical' : 'warning',
      problem: alertTypeLabel(type) + (count > 1 ? ` (${count} ocorrências)` : ''),
      impact: meta.impact,
      solutionDoc: meta.doc,
      section: meta.section,
      count,
    });
  }

  const status = input.status ?? [];
  const inconsistent = status.filter((s) => s.status === 'inconsistent' || s.status === 'error');
  if (inconsistent.length > 0) {
    push({
      id: 'status-inconsistent',
      severity: 'warning',
      problem: `${inconsistent.length} dia(s) com jornada inconsistente ou erro`,
      impact: 'Cálculo de horas e pré-folha podem sair incorretos',
      solutionDoc: 'auditoria-jornada',
      section: 'erros-comuns',
      count: inconsistent.length,
    });
  }

  const pendingRep = status.filter((s) => s.status === 'pending_rep' || s.total_rep_pending > 0);
  if (pendingRep.length > 0 && !seen.has('alert-rep_pending_stale')) {
    const total = pendingRep.reduce((s, r) => s + (r.total_rep_pending || 0), 0);
    push({
      id: 'status-rep-pending',
      severity: 'critical',
      problem: `REP pendente em ${pendingRep.length} colaborador(es)`,
      impact: 'Batidas do relógio ainda não estão no espelho oficial',
      solutionDoc: 'relogios-rep',
      section: 'erros-comuns',
      count: total || pendingRep.length,
    });
  }

  const openTasks = (input.tasks ?? []).filter((t) => t.status !== 'resolved' && t.status !== 'done');
  if (openTasks.length > 0) {
    push({
      id: 'tasks-open',
      severity: 'warning',
      problem: `${openTasks.length} tarefa(s) operacional(is) em aberto`,
      impact: 'Pendências podem atrasar fechamento do período',
      solutionDoc: 'jornada',
      section: 'boas-praticas',
      count: openTasks.length,
    });
  }

  for (const insight of input.insights ?? []) {
    push({
      id: `insight-${insight.id}`,
      severity: insight.severity === 'warning' ? 'warning' : 'info',
      problem: insight.message,
      impact: impactFromInsight(insight.id),
      solutionDoc: insight.doc,
      section: insight.section,
      count: insight.count,
    });
  }

  const order: Record<DiagnosticSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

function alertTypeLabel(t: string): string {
  const labels: Record<string, string> = {
    missing_exit: 'Falta de batida de saída',
    long_break: 'Intervalo de almoço prolongado',
    excess_hours: 'Jornada acima do esperado',
    inconsistency: 'Inconsistência na jornada',
    rep_pending_stale: 'Batida REP pendente há muito tempo',
  };
  return labels[t] ?? t;
}

function impactFromInsight(id: string): string {
  const map: Record<string, string> = {
    'employees-no-schedule': 'Cálculo de ponto incorreto — faltas e extras podem estar erradas',
    'rep-pending': 'Marcações do relógio não entram no espelho até resolver',
    'bank-negative': 'Compensação e folha podem ser afetadas',
    'no-employees': 'Importação REP e espelho não têm colaboradores vinculados',
  };
  return map[id] ?? 'Pode afetar o fechamento do período';
}
