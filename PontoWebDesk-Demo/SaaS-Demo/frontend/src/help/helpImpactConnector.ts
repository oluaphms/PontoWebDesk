import type { HelpDocSlug } from './helpCenterCatalog';
import { analyzeOperationalState, type OperationalDiagnosticInput } from './helpDiagnosticEngine';
import { computeOperationalMaturity, type OperationalMaturityInput } from './operationalMaturityEngine';
import { DAILY_CHECKLIST_ITEMS } from './helpDailyChecklist';

/** Impacto estimado do tema na maturidade (pontos). */
const DOC_MATURITY_IMPACT: Partial<Record<HelpDocSlug, number>> = {
  colaboradores: 25,
  jornada: 18,
  'espelho-de-ponto': 15,
  'banco-de-horas': 12,
  'relogios-rep': 20,
  'auditoria-jornada': 22,
  escalas: 14,
  horarios: 12,
  'pre-folha': 10,
};

const DOC_CHECKLIST_LINKS: Partial<Record<HelpDocSlug, string[]>> = {
  'auditoria-jornada': ['audit-inconsistencies', 'review-critical-alerts'],
  'espelho-de-ponto': ['validate-today-punches'],
  'banco-de-horas': ['check-bank-hours'],
  'relogios-rep': ['sync-rep'],
};

export interface DocImpactContext {
  maturityPoints: number;
  relatedChecklist: string[];
  activeDiagnostics: string[];
  summaryLine: string;
}

/**
 * Conecta documentação aberta ao impacto operacional atual (local).
 */
export function getDocImpactContext(
  doc: HelpDocSlug,
  operationalInput?: OperationalMaturityInput,
): DocImpactContext {
  const points = DOC_MATURITY_IMPACT[doc] ?? 8;
  const checklistIds = DOC_CHECKLIST_LINKS[doc] ?? [];
  const relatedChecklist = DAILY_CHECKLIST_ITEMS.filter((c) => checklistIds.includes(c.id)).map((c) => c.label);

  let activeDiagnostics: string[] = [];
  if (operationalInput) {
    const maturity = computeOperationalMaturity(operationalInput);
    const diagnostics = analyzeOperationalState(operationalInput as OperationalDiagnosticInput);
    activeDiagnostics = diagnostics.slice(0, 3).map((d) => d.problem);
    if (maturity.issues.some((i) => i.doc === doc)) {
      activeDiagnostics.unshift(`Pendência ativa neste módulo (${points} pts na maturidade)`);
    }
  }

  const summaryLine =
    points >= 15
      ? `Este tema afeta fortemente sua maturidade (até ${points} pontos).`
      : `Este tema pode afetar sua maturidade em até ${points} pontos.`;

  return {
    maturityPoints: points,
    relatedChecklist,
    activeDiagnostics,
    summaryLine,
  };
}
