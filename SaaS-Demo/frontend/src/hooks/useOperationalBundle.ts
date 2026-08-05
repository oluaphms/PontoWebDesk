/**
 * ⚠️ SINGLE SOURCE OF TRUTH — dados operacionais (P0).
 *
 * Todos os painéis de maturidade/diagnóstico/misuse devem receber `bundle` deste hook.
 *
 * NUNCA em `src/components/help/*`:
 * - `useQueries` + fetchOperationalAlerts/Status/Tasks/Risk
 * - `computeOperationalMaturity` / `analyzeOperationalState`
 *
 * SEMPRE na página: `const op = useOperationalBundle(companyId, totalEmployees)`
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { apiQueryKeys } from '../lib/apiQueryKeys';
import { fetchOperationalAlerts } from '../services/operationalAlerts.service';
import { fetchOperationalRisk } from '../services/operationalRisk.service';
import { fetchOperationalStatus } from '../services/operationalStatus.service';
import { fetchOperationalTasks } from '../services/operationalTasks.service';
import { buildHelpInsightsFromContext, fetchHelpInsights, type HelpInsight } from '../help/helpInsightsEngine';
import {
  analyzeOperationalState,
  type OperationalDiagnosticItem,
} from '../help/helpDiagnosticEngine';
import {
  computeOperationalMaturity,
  type OperationalMaturityResult,
} from '../help/operationalMaturityEngine';
import { getDailyChecklistProgressPercent } from '../help/helpDailyChecklist';
import { getOnboardingStep, isOnboardingCompleted } from '../help/helpProgress';
import { ONBOARDING_TOTAL } from '../help/onboardingSteps';
import type { OperationalAlertRow } from '../services/operationalAlerts.service';
import type { CompanyRiskApiPayload } from '../services/operationalRisk.service';
import type { OperationalDayStatusRow } from '../services/operationalStatus.service';
import type { OperationalTaskRow } from '../services/operationalTasks.service';

export interface OperationalBundle {
  alerts: OperationalAlertRow[];
  tasks: OperationalTaskRow[];
  status: OperationalDayStatusRow[];
  risk: CompanyRiskApiPayload | null;
  insights: HelpInsight[];
  maturity: OperationalMaturityResult;
  diagnostics: OperationalDiagnosticItem[];
  totalEmployees: number;
  isLoading: boolean;
}

export function useOperationalBundle(
  companyId: string,
  totalEmployees = 0,
  enabled = true,
): OperationalBundle {
  const [alertsQ, statusQ, tasksQ, riskQ, insightsQ] = useQueries({
    queries: [
      {
        queryKey: apiQueryKeys.operationalAlerts(companyId),
        queryFn: () => fetchOperationalAlerts(companyId),
        enabled: enabled && !!companyId,
        staleTime: 8000,
      },
      {
        queryKey: apiQueryKeys.operationalStatus(companyId),
        queryFn: () => fetchOperationalStatus(companyId),
        enabled: enabled && !!companyId,
        staleTime: 8000,
      },
      {
        queryKey: apiQueryKeys.operationalTasks(companyId),
        queryFn: () => fetchOperationalTasks(companyId),
        enabled: enabled && !!companyId,
        staleTime: 8000,
      },
      {
        queryKey: apiQueryKeys.operationalRisk(companyId),
        queryFn: () => fetchOperationalRisk(companyId),
        enabled: enabled && !!companyId,
        staleTime: 8000,
      },
      {
        queryKey: ['help-insights', companyId],
        queryFn: () => fetchHelpInsights(companyId),
        enabled: enabled && !!companyId,
        staleTime: 30000,
      },
    ],
  });

  const alerts = alertsQ.data ?? [];
  const tasks = tasksQ.data ?? [];
  const status = statusQ.data ?? [];
  const risk = riskQ.data ?? null;

  const insights = useMemo(() => {
    const base = buildHelpInsightsFromContext({ totalEmployees });
    const remote = insightsQ.data ?? [];
    const merged = [...base];
    for (const r of remote) {
      if (!merged.some((m) => m.id === r.id)) merged.push(r);
    }
    return merged;
  }, [insightsQ.data, totalEmployees]);

  const onboardingProgressPercent = isOnboardingCompleted()
    ? 100
    : Math.round((getOnboardingStep() / ONBOARDING_TOTAL) * 100);

  const operationalInput = useMemo(
    () => ({
      alerts,
      status,
      tasks,
      risk,
      insights,
      totalEmployees,
      onboardingProgressPercent,
      dailyChecklistPercent: getDailyChecklistProgressPercent(),
    }),
    [alerts, status, tasks, risk, insights, totalEmployees, onboardingProgressPercent],
  );

  const maturity = useMemo(
    () => computeOperationalMaturity(operationalInput),
    [operationalInput],
  );

  const diagnostics = useMemo(
    () => analyzeOperationalState(operationalInput),
    [operationalInput],
  );

  const isLoading =
    alertsQ.isLoading ||
    statusQ.isLoading ||
    tasksQ.isLoading ||
    riskQ.isLoading ||
    insightsQ.isLoading;

  return {
    alerts,
    tasks,
    status,
    risk,
    insights,
    maturity,
    diagnostics,
    totalEmployees,
    isLoading,
  };
}
