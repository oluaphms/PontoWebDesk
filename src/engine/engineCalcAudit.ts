import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { db, isSupabaseConfigured } from '../services/supabaseClient';

export interface EngineCalcAuditPayload {
  date: string;
  expected: number;
  worked: number;
  extra: number;
  negative: number;
  falta: number;
  extra_50: number;
  extra_100: number;
  extra_noturna_payable?: number;
  banco_creditado: number;
  banco_utilizado: number;
  extra_banco?: number;
  extra_folha_50?: number;
  extra_folha_100?: number;
  origem: 'calc_engine';
  timestamp: string;
}

/** Trilha append-only (sem UPDATE). Falha silenciosa se tabela/RLS indisponível. */
export async function appendEngineCalcAudit(params: {
  employeeId: string;
  companyId: string;
  payload: EngineCalcAuditPayload;
}): Promise<void> {
  if (!isSupabaseConfigured() || !params.companyId) return;
  await db
    .insert('engine_calc_audit', {
      employee_id: params.employeeId,
      company_id: params.companyId,
      date: params.payload.date,
      payload: params.payload,
    })
    .catch((err) => {
      if (import.meta.env?.DEV) {
        observabilityConsole.warn('[engineCalcAudit] insert falhou:', err);
      }
    });
}
