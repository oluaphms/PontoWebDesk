/**
 * Worker de reconciliação multi-fonte (COS, live, batidas, timeline) com limite por tenant.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createOperationalCorrelationId } from '../correlationId';
import {
  auditCurrentOperationalStateIntegrity,
  repairOperationalStateDrift,
  type OperationalStateIntegrityReport,
} from './currentOperationalStateReconciler';
import { auditTimelineIntegrity } from '../consistency/distributedConsistencyAudit';
import { operationalNowUtcIso } from '../../../utils/operationalDateHardLock';
import { retryBudget } from '../resilience';

export type OperationalReconciliationWorkerResult = {
  tenants_scanned: number;
  tenants_repaired: number;
  reports: Array<{ companyId: string; cos: OperationalStateIntegrityReport; timelineIssues: number }>;
};

const TENANT_BUDGET_KEY = 'reconciliation_worker:tenant';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Escaneia tenants em blocos; opcionalmente aplica `repairOperationalStateDrift` quando há divergências COS.
 * Não altera regras de negócio — apenas RPCs e auditorias já existentes.
 */
export async function runOperationalReconciliationWorker(input: {
  client: SupabaseClient;
  companyIds: string[];
  chunkSize?: number;
  maxTenantsPerRun?: number;
  autoRepair?: boolean;
  correlationId?: string;
}): Promise<OperationalReconciliationWorkerResult> {
  const {
    client,
    companyIds,
    chunkSize = 6,
    maxTenantsPerRun = 24,
    autoRepair = false,
    correlationId = createOperationalCorrelationId(),
  } = input;

  const unique = Array.from(new Set(companyIds.filter(Boolean)));
  const limited = unique.slice(0, maxTenantsPerRun);

  console.info('[RECONCILIATION START]', {
    correlation_id: correlationId,
    tenants: limited.length,
    auto_repair: autoRepair,
    at: operationalNowUtcIso(),
  });

  const reports: OperationalReconciliationWorkerResult['reports'] = [];
  let tenants_repaired = 0;

  for (const batch of chunk(limited, chunkSize)) {
    for (const companyId of batch) {
      if (!retryBudget.allow(`${TENANT_BUDGET_KEY}:${companyId}`, 20)) {
        console.info('[RECONCILIATION FAILED]', { company_id: companyId, reason: 'tenant_budget' });
        continue;
      }
      try {
        const cos = await auditCurrentOperationalStateIntegrity(client, companyId);
        const timelineFindings = await auditTimelineIntegrity(client, companyId);
        if (cos.details.length > 0) {
          console.warn('[RECONCILIATION DRIFT]', {
            company_id: companyId,
            drift: cos.drift_count,
            samples: cos.details.slice(0, 8),
          });
        }
        if (timelineFindings.length > 0) {
          console.warn('[RECONCILIATION DRIFT]', {
            company_id: companyId,
            kind: 'timeline',
            findings: timelineFindings.length,
          });
        }
        if (autoRepair && cos.details.length > 0) {
          const { repaired_count } = await repairOperationalStateDrift(client, companyId, correlationId);
          tenants_repaired += repaired_count > 0 ? 1 : 0;
          if (repaired_count > 0) {
            console.info('[RECONCILIATION AUTO FIX]', { company_id: companyId, repaired_count });
          }
        }
        reports.push({
          companyId,
          cos,
          timelineIssues: timelineFindings.reduce((a, f) => a + f.count, 0),
        });
      } catch (e) {
        console.warn('[RECONCILIATION FAILED]', { company_id: companyId, error: String(e) });
      }
    }
  }

  console.info('[RECONCILIATION COMPLETE]', {
    correlation_id: correlationId,
    scanned: reports.length,
    repaired_tenants: tenants_repaired,
  });

  return { tenants_scanned: reports.length, tenants_repaired, reports };
}
