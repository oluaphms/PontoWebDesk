import React, { Suspense, lazy, useCallback, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { BarChart3, BookOpen, Download, Loader2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useOperationalBundle } from '../../hooks/useOperationalBundle';
import PageHeader from '../../components/PageHeader';
import RoleGuard from '../../components/auth/RoleGuard';
import { LoadingState } from '../../../components/UI';
import { collectOperationalSnapshot } from '../../help/helpSnapshotCollector';
import { useOperationalAchievementUnlock } from '../../help/useOperationalAchievementUnlock';
import { downloadOperationalReport } from '../../help/helpReportBuilder';
import { MaturityBenchmarkBlock } from '../../components/help/MaturityBenchmarkBlock';
import { MaturityEvolutionSection } from '../../components/help/MaturityEvolutionSection';
import { HelpDebugPanel } from '../../components/help/HelpDebugPanel';
import { ValueProofTrigger } from '../../components/help/ValueProofTrigger';

const OperationalMaturityCard = lazy(() =>
  import('../../components/help/OperationalMaturityCard').then((m) => ({ default: m.OperationalMaturityCard })),
);
const DailyChecklistPanel = lazy(() =>
  import('../../components/help/DailyChecklistPanel').then((m) => ({ default: m.DailyChecklistPanel })),
);
const OperationalDiagnosticPanel = lazy(() =>
  import('../../components/help/OperationalDiagnosticPanel').then((m) => ({ default: m.OperationalDiagnosticPanel })),
);
const MisuseWarningsPanel = lazy(() =>
  import('../../components/help/MisuseWarningsPanel').then((m) => ({ default: m.MisuseWarningsPanel })),
);
const AchievementsPanel = lazy(() =>
  import('../../components/help/AchievementsPanel').then((m) => ({ default: m.AchievementsPanel })),
);

const PanelFallback = () => (
  <div className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-800/50 animate-pulse" aria-hidden />
);

export default function OperationalIntelligence() {
  const { user, loading, companyId } = useAuth();
  const [exporting, setExporting] = useState(false);
  const op = useOperationalBundle(companyId ?? '', 0, !!companyId);
  const newlyUnlocked = useOperationalAchievementUnlock(companyId ?? '');

  const handleExport = useCallback(
    async (format: 'markdown' | 'json') => {
      if (!companyId) return;
      setExporting(true);
      try {
        const snapshot = await collectOperationalSnapshot(companyId);
        downloadOperationalReport(snapshot, format);
      } finally {
        setExporting(false);
      }
    },
    [companyId],
  );

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard allowedRoles={['admin', 'hr']}>
      <div className="space-y-8 pb-10">
        <PageHeader
          title="Inteligência Operacional"
          subtitle="Visão estratégica do RH baseada no uso do sistema"
          icon={<BarChart3 size={24} />}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                to="/admin/ajuda"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <BookOpen size={16} />
                Ver Central de Ajuda
              </Link>
              <button
                type="button"
                disabled={exporting || !companyId}
                onClick={() => void handleExport('markdown')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold"
              >
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Exportar (Markdown)
              </button>
              <button
                type="button"
                disabled={exporting || !companyId}
                onClick={() => void handleExport('json')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                Exportar (JSON)
              </button>
            </div>
          }
        />

        {companyId ? (
          <>
            <section className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Maturidade
              </h2>
              <Suspense fallback={<PanelFallback />}>
                <OperationalMaturityCard bundle={op} />
              </Suspense>
              <MaturityBenchmarkBlock showProofButton={false} />
            </section>

            <section className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Evolução
              </h2>
              <MaturityEvolutionSection
                openAlertsCount={op.alerts.filter((a) => !a.resolved).length}
              />
            </section>

            <section className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Ações práticas
              </h2>
              <Suspense fallback={<PanelFallback />}>
                <DailyChecklistPanel />
              </Suspense>
              <Suspense fallback={<PanelFallback />}>
                <OperationalDiagnosticPanel bundle={op} />
              </Suspense>
              <Suspense fallback={<PanelFallback />}>
                <MisuseWarningsPanel bundle={op} />
              </Suspense>
            </section>

            <section className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Engajamento
              </h2>
              <Suspense fallback={<PanelFallback />}>
                <AchievementsPanel newlyUnlocked={newlyUnlocked} />
              </Suspense>
            </section>

            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-5">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">Prova de valor</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Compare a evolução da maturidade operacional e o impacto das ações do RH no sistema.
              </p>
              <ValueProofTrigger />
            </section>
          </>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Associe uma empresa para ver a inteligência operacional.
          </p>
        )}

        <HelpDebugPanel companyId={companyId ?? undefined} />
      </div>
    </RoleGuard>
  );
}
