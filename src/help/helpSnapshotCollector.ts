import type { OperationalSnapshot } from '../types/operational-intelligence';
import { fetchOperationalAlerts } from '../services/operationalAlerts.service';
import { fetchOperationalRisk } from '../services/operationalRisk.service';
import { fetchOperationalStatus } from '../services/operationalStatus.service';
import { fetchOperationalTasks } from '../services/operationalTasks.service';
import { buildHelpInsightsFromContext, fetchHelpInsights } from './helpInsightsEngine';
import { analyzeOperationalState } from './helpDiagnosticEngine';
import { computeOperationalMaturity } from './operationalMaturityEngine';
import { computeOperationalBenchmark } from './operationalBenchmarkEngine';
import { getImpactPhrase } from './helpImpactPhrases';
import { getMaturityEvolutionSummary, getMaturityHistory } from './helpMaturityHistory';
import {
  DAILY_CHECKLIST_ITEMS,
  getDailyChecklistDoneIds,
  getDailyChecklistProgressPercent,
} from './helpDailyChecklist';
import { getAchievementsWithStatus } from './helpAchievements';
import { getOnboardingStep, isOnboardingCompleted } from './helpProgress';
import { ONBOARDING_TOTAL } from './onboardingSteps';

export async function collectOperationalSnapshot(
  companyId: string,
  totalEmployees = 0,
): Promise<OperationalSnapshot> {
  const [alerts, status, tasks, risk, remoteInsights] = await Promise.all([
    fetchOperationalAlerts(companyId).catch(() => []),
    fetchOperationalStatus(companyId).catch(() => []),
    fetchOperationalTasks(companyId).catch(() => []),
    fetchOperationalRisk(companyId).catch(() => null),
    fetchHelpInsights(companyId).catch(() => []),
  ]);

  const insights = [...buildHelpInsightsFromContext({ totalEmployees })];
  for (const r of remoteInsights) {
    if (!insights.some((m) => m.id === r.id)) insights.push(r);
  }

  const onboardingProgressPercent = isOnboardingCompleted()
    ? 100
    : Math.round((getOnboardingStep() / ONBOARDING_TOTAL) * 100);

  const maturity = computeOperationalMaturity({
    alerts,
    status,
    tasks,
    risk,
    insights,
    totalEmployees,
    onboardingProgressPercent,
    dailyChecklistPercent: getDailyChecklistProgressPercent(),
  });

  const benchmark = computeOperationalBenchmark(maturity.score);
  const doneIds = new Set(getDailyChecklistDoneIds());

  const history = getMaturityHistory();
  const score =
    history.length > 0 ? history[history.length - 1].score : maturity.score;

  return {
    company_id: companyId,
    score,
    level: maturity.level,
    benchmark_percentile: benchmark.percentile,
    benchmark_comparison: benchmark.comparison,
    issues: analyzeOperationalState({
      alerts,
      status,
      tasks,
      risk,
      insights,
      totalEmployees,
    }),
    checklist: DAILY_CHECKLIST_ITEMS.map((item) => ({
      id: item.id,
      label: item.label,
      done: doneIds.has(item.id),
    })),
    achievements: getAchievementsWithStatus().map((a) => ({
      id: a.id,
      title: a.title,
      unlocked: a.unlocked,
    })),
    evolution_message: getMaturityEvolutionSummary(7)?.message ?? null,
    impact_phrase: getImpactPhrase(score),
    generated_at: new Date().toISOString(),
  };
}
