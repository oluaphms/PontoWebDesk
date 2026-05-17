export {
  HELP_NAV_GROUPS,
  HELP_DOC_SLUGS,
  HELP_DOC_LABELS,
  HELP_ROUTE_TO_DOC,
  DEFAULT_HELP_DOC,
  isHelpDocSlug,
  resolveHelpDocFromPath,
  getAllHelpNavItems,
  type HelpDocSlug,
  type HelpNavGroup,
  type HelpNavItem,
} from './helpCenterCatalog';
export {
  loadHelpDoc,
  getCachedHelpDoc,
  preloadAllHelpDocs,
  preloadCriticalHelpDocs,
  CRITICAL_HELP_SLUGS,
  isHelpDocAvailable,
} from './helpDocLoader';
export { openHelp, getHelpCenterPath, resolveContextualHelpSlug, openHelpFromError } from './openHelp';
export { useAutoHelp, resolveAutoHelpDocSlug } from './useAutoHelp';
export { HELP_ERROR_MAP, detectHelpErrorCode, type HelpErrorCode } from './helpErrorMap';
export { emitHelpError, emitHelpErrorFromMessage } from './helpErrorBridge';
export { trackHelpAnalytics, type HelpAnalyticsEvent } from './helpAnalytics';
export { fetchHelpInsights, buildHelpInsightsFromContext, type HelpInsight } from './helpInsightsEngine';
export { ONBOARDING_STEPS, ONBOARDING_TOTAL } from './onboardingSteps';
export { resolveHelpSectionId } from './helpSectionResolve';
export { searchHelpDocs, getSuggestedQuestions, type HelpSearchResult } from './helpSearchEngine';
export {
  analyzeOperationalState,
  type OperationalDiagnosticItem,
  type OperationalDiagnosticInput,
  type DiagnosticSeverity,
} from './helpDiagnosticEngine';
export { summarizeHelpDoc, extractHelpSection } from './helpSummarizer';
export {
  TRAINING_MODULES,
  isTrainingModeEnabled,
  setTrainingModeEnabled,
  markTrainingModuleDone,
  getTrainingProgressPercent,
  getTrainingModulesWithStatus,
} from './helpTrainingMode';
export { recordHelpFeedback, getHelpFeedbackSummary, type HelpFeedbackEntry } from './helpFeedback';
export { useActionHelpHints, type ActionHelpHint } from './useActionHelpHints';
export {
  computeOperationalMaturity,
  maturityLevelEmoji,
  maturityLevelLabel,
  type OperationalMaturityResult,
  type MaturityLevel,
  type MaturityIssue,
} from './operationalMaturityEngine';
export {
  DAILY_CHECKLIST_ITEMS,
  getDailyChecklistProgressPercent,
  toggleDailyChecklistItem,
  isDailyChecklistItemDone,
} from './helpDailyChecklist';
export { trackBehaviorRoute, trackBehaviorDoc, getBehaviorSuggestions } from './helpBehaviorTracker';
export { detectOperationalMisuse, recordManualTimesheetEdit, type MisuseWarning } from './helpMisuseDetector';
export { explainDashboardMetric, type DashboardMetricId } from './helpExplainMetrics';
export { logHelpRoi, getHelpRoiSnapshot } from './helpRoi';
export {
  isTrainingAdminModeEnabled,
  setTrainingAdminModeEnabled,
  getRequiredTrainingModules,
  getUserTrainingProgress,
} from './helpTrainingAdmin';
export { exportHelpManualAsMarkdown, exportHelpManualAsPrintablePdf } from './helpKnowledgeExport';
export {
  computeOperationalBenchmark,
  benchmarkComparisonLabel,
  type OperationalBenchmarkResult,
  type BenchmarkComparison,
} from './operationalBenchmarkEngine';
export { getImpactPhrase, getValueProofHeadline } from './helpImpactPhrases';
export {
  recordDailyMaturityScore,
  getMaturityHistory,
  getMaturityEvolutionSummary,
  getInitialMaturityScore,
} from './helpMaturityHistory';
export { detectOperationalRegression, type RegressionAlert } from './helpRegressionDetector';
export {
  HELP_ACHIEVEMENTS,
  checkAndUnlockAchievements,
  getAchievementsWithStatus,
} from './helpAchievements';
export { buildWeeklySummary, recordWeeklyAlertResolved } from './helpWeeklySummary';
export {
  PW_HELP_OPENED,
  PW_MATURITY_UPDATED,
  PW_CHECKLIST_COMPLETED,
  PW_ACHIEVEMENT_UNLOCKED,
  dispatchPwHelpOpened,
  dispatchPwMaturityUpdated,
  dispatchPwChecklistCompleted,
  dispatchPwAchievementUnlocked,
  isHelpDebugEnabled,
} from './helpEvents';
export { getDocImpactContext, type DocImpactContext } from './helpImpactConnector';
export {
  buildOperationalReport,
  buildOperationalReportMarkdown,
  buildOperationalReportJson,
  downloadOperationalReport,
} from './helpReportBuilder';
export { collectOperationalSnapshot } from './helpSnapshotCollector';
export { useLiveMaturityScore } from './useLiveMaturityScore';
export { useOperationalAchievementUnlock } from './useOperationalAchievementUnlock';
