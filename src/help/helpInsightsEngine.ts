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
 * Consultas leves no Supabase para sugestões baseadas na documentação.
 */
export async function fetchHelpInsights(companyId: string): Promise<HelpInsight[]> {
  const insights: HelpInsight[] = [];
  if (!companyId || !isSupabaseConfigured()) return insights;

  try {
    const { data: users, error: usersErr } = await db
      .from('users')
      .select('id, schedule_id, shift_id, ativo')
      .eq('company_id', companyId)
      .eq('ativo', true);

    if (!usersErr && users) {
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
    }

    const { count: repPending, error: repErr } = await db
      .from('rep_punch_logs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('time_record_id', null);

    if (!repErr && repPending && repPending > 0) {
      insights.push({
        id: 'rep-pending',
        severity: 'warning',
        message: `${repPending} batida(s) REP aguardando resolução`,
        doc: 'relogios-rep',
        section: 'erros-comuns',
        count: repPending,
      });
    }

    const { data: balances, error: bhErr } = await db
      .from('time_balance')
      .select('user_id, balance_minutes')
      .eq('company_id', companyId)
      .lt('balance_minutes', 0)
      .limit(100);

    if (!bhErr && balances && balances.length > 0) {
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
    console.warn('[helpInsightsEngine]', e);
  }

  return insights;
}
