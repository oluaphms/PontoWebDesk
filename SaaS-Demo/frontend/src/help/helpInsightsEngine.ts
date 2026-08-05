import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import type { HelpDocSlug } from './helpCenterCatalog';

export type HelpInsightSeverity = 'warning' | 'info';

export interface HelpInsight {
  id: string;
  severity: HelpInsightSeverity;
  message: string;
  doc: HelpDocSlug;
  section?: string;
  count?: number;
}

export interface HelpInsightsContext {
  totalEmployees?: number;
  activeEmployees?: number;
}

/**
 * Insights síncronos a partir de dados já carregados no dashboard.
 */
export function buildHelpInsightsFromContext(ctx: HelpInsightsContext): HelpInsight[] {
  const insights: HelpInsight[] = [];
  if (ctx.totalEmployees === 0) {
    insights.push({
      id: 'no-employees',
      severity: 'info',
      message: 'Nenhum colaborador cadastrado — comece pelo cadastro.',
      doc: 'colaboradores',
      section: 'como-usar',
    });
  }
  return insights;
}

/**
 * Consultas leves para sugestões baseadas na documentação (API VPS ou Supabase).
 */
export async function fetchHelpInsights(companyId: string): Promise<HelpInsight[]> {
  const insights: HelpInsight[] = [];
  if (!companyId || !isSupabaseConfigured()) return insights;

  try {
    const users = await db.select<{ schedule_id?: string; shift_id?: string }>(
      'users',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'ativo', operator: 'eq', value: true },
      ],
      undefined,
      500,
    );

    const withoutJourney = users.filter((u) => !u.schedule_id && !u.shift_id);
    if (withoutJourney.length > 0) {
      insights.push({
        id: 'employees-no-schedule',
        severity: 'warning',
        message: `${withoutJourney.length} colaborador(es) sem escala ou horário definido`,
        doc: 'jornada',
        section: 'erros-comuns',
        count: withoutJourney.length,
      });
    }

    const repPending = await db.count('rep_punch_logs', [
      { column: 'company_id', operator: 'eq', value: companyId },
      { column: 'time_record_id', operator: 'is', value: null },
    ]);

    if (repPending > 0) {
      insights.push({
        id: 'rep-pending',
        severity: 'warning',
        message: `${repPending} batida(s) REP aguardando resolução`,
        doc: 'relogios-rep',
        section: 'erros-comuns',
        count: repPending,
      });
    }

    const balances = await db.select<{ user_id?: string }>(
      'time_balance',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'balance_minutes', operator: 'lt', value: 0 },
      ],
      undefined,
      100,
    );

    if (balances.length > 0) {
      insights.push({
        id: 'bank-negative',
        severity: 'warning',
        message: `${balances.length} colaborador(es) com saldo negativo no banco de horas`,
        doc: 'banco-de-horas',
        section: 'erros-comuns',
        count: balances.length,
      });
    }
  } catch (e) {
    observabilityConsole.warn('[helpInsightsEngine]', e);
  }

  return insights;
}
