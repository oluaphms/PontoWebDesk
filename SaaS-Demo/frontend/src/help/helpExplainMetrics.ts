export type DashboardMetricId =
  | 'totalEmployees'
  | 'activeEmployees'
  | 'recordsToday'
  | 'absentToday';

export interface MetricExplanation {
  id: DashboardMetricId;
  hint: string;
}

const EXPLANATIONS: Record<DashboardMetricId, string> = {
  totalEmployees:
    'Total de colaboradores cadastrados na empresa. Inclui ativos e inativos conforme o cadastro.',
  activeEmployees:
    'Colaboradores marcados como ativos e aptos a registrar ponto no período.',
  recordsToday:
    'Batidas registradas hoje (app, web ou REP importado). Útil para conferir se o dia está movimentado.',
  absentToday:
    'Colaboradores ativos sem nenhuma batida no dia. Pode indicar falta, folga ou falha de REP.',
};

export function explainDashboardMetric(id: DashboardMetricId): string {
  return EXPLANATIONS[id] ?? '';
}

export function getAllDashboardMetricExplanations(): MetricExplanation[] {
  return (Object.keys(EXPLANATIONS) as DashboardMetricId[]).map((id) => ({
    id,
    hint: EXPLANATIONS[id],
  }));
}
