/**
 * Reconciliação GEO/COS agendada por tenant (chunked, com orçamento — usar a partir de job operacional).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createOperationalCorrelationId } from '../correlationId';
import { auditCurrentOperationalStateIntegrity, repairOperationalStateDrift } from './currentOperationalStateReconciler';
import { operationalNowUtcIso } from '../../../utils/operationalDateHardLock';
import { retryBudget } from '../resilience';
import { operationalReliabilitySLO } from '../reliability/operationalReliabilitySLO';

const BUDGET_KEY = 'scheduled_geo_recon:tenant';

export type ScheduledOperationalGeoReconciliationResult = {
  company_id: string;
  drift_count: number;
  repaired_count: number;
  skipped: boolean;
};

/**
 * Uma passagem por empresa: audita COS e aplica repair quando há drift (mesmo fluxo que self-heal seguro).
 */
export async function scheduledOperationalGeoReconciliation(input: {
  client: SupabaseClient;
  companyId: string;
  correlationId?: string;
}): Promise<ScheduledOperationalGeoReconciliationResult> {
  const { client, companyId, correlationId = createOperationalCorrelationId() } = input;

  if (!retryBudget.allow(`${BUDGET_KEY}:${companyId}`, 8)) {
    console.info('[GEO RECONCILIATION COMPLETE]', { company_id: companyId, skipped: true, reason: 'budget' });
    operationalReliabilitySLO.recordReconciliationSuccess(false);
    return { company_id: companyId, drift_count: 0, repaired_count: 0, skipped: true };
  }

  console.info('[GEO RECONCILIATION START]', { company_id: companyId, correlation_id: correlationId, at: operationalNowUtcIso() });

  const audit = await auditCurrentOperationalStateIntegrity(client, companyId);
  if (audit.drift_count === 0) {
    console.info('[GEO RECONCILIATION COMPLETE]', { company_id: companyId, drift_count: 0, repaired_count: 0 });
    operationalReliabilitySLO.recordReconciliationSuccess(true);
    return { company_id: companyId, drift_count: 0, repaired_count: 0, skipped: false };
  }

  const { repaired_count } = await repairOperationalStateDrift(client, companyId, correlationId);
  if (repaired_count > 0) {
    console.info('[GEO RECONCILIATION FIX]', { company_id: companyId, repaired_count });
  }
  console.info('[GEO RECONCILIATION COMPLETE]', {
    company_id: companyId,
    drift_count: audit.drift_count,
    repaired_count,
  });

  operationalReliabilitySLO.recordReconciliationSuccess(true);
  return { company_id: companyId, drift_count: audit.drift_count, repaired_count, skipped: false };
}
