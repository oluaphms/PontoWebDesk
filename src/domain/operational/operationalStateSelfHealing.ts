/**
 * Auto-reparo operacional: audita divergências COS vs batidas e força refresh via RPC quando necessário.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createOperationalCorrelationId } from './correlationId';
import { repairOperationalStateDrift } from './reconciliation/currentOperationalStateReconciler';

export async function runOperationalStateSelfHeal(
  client: SupabaseClient,
  companyId: string,
  correlationId: string = createOperationalCorrelationId(),
): Promise<{ ok: boolean; repaired: number; hadIssues: boolean }> {
  console.info('[SELF HEAL START]', { company_id: companyId, correlation_id: correlationId });
  try {
    const { repaired_count, report } = await repairOperationalStateDrift(client, companyId, correlationId);
    const hadIssues = report.details.length > 0;
    if (!hadIssues) {
      console.info('[SELF HEAL SUCCESS]', { company_id: companyId, repaired: 0, note: 'no_drift' });
      return { ok: true, repaired: 0, hadIssues: false };
    }
    console.info('[SELF HEAL SUCCESS]', {
      company_id: companyId,
      repaired: repaired_count,
      drift: report.drift_count,
    });
    return { ok: true, repaired: repaired_count, hadIssues: true };
  } catch (e) {
    console.warn('[SELF HEAL FAILED]', { company_id: companyId, error: String(e) });
    return { ok: false, repaired: 0, hadIssues: true };
  }
}
