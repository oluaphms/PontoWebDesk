import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { maturityLevelEmoji, maturityLevelLabel } from '../../help/operationalMaturityEngine';
import { openHelp } from '../../help/openHelp';
import { trackHelpAnalytics } from '../../help/helpAnalytics';
import { logHelpRoi } from '../../help/helpRoi';
import { recordDailyMaturityScore } from '../../help/helpMaturityHistory';
import { dispatchPwMaturityUpdated } from '../../help/helpEvents';
import type { OperationalBundle } from '../../hooks/useOperationalBundle';

interface OperationalMaturityCardProps {
  bundle: OperationalBundle;
}

export const OperationalMaturityCard: React.FC<OperationalMaturityCardProps> = ({ bundle }) => {
  const navigate = useNavigate();
  const { maturity, isLoading } = bundle;

  useEffect(() => {
    if (isLoading) return;
    recordDailyMaturityScore(maturity.score);
    dispatchPwMaturityUpdated({ score: maturity.score });
  }, [isLoading, maturity.score]);

  if (isLoading) {
    return (
      <div className="h-28 rounded-2xl bg-slate-100 dark:bg-slate-800/50 animate-pulse" aria-hidden />
    );
  }

  const improve = () => {
    trackHelpAnalytics('insight_clicked', { insightId: 'maturity-improve', doc: 'auditoria-jornada' });
    logHelpRoi('resolver_click');
    const first = maturity.issues[0];
    if (first?.doc) {
      openHelp(first.doc, navigate, { section: first.section, resolveSection: true });
    } else {
      navigate('/admin/ajuda');
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center shrink-0">
            <TrendingUp className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
              {maturityLevelEmoji(maturity.level)} Maturidade operacional: {maturity.score}%
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Nível {maturityLevelLabel(maturity.level)} — {maturity.summary}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={improve}
          className="shrink-0 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
        >
          Melhorar sistema
        </button>
      </div>
      <div className="mt-3 flex justify-end">
        <Link
          to="/admin/inteligencia-operacional"
          className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Centro de comando →
        </Link>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${
            maturity.score >= 75
              ? 'bg-emerald-500'
              : maturity.score >= 45
                ? 'bg-amber-500'
                : 'bg-red-500'
          }`}
          style={{ width: `${maturity.score}%` }}
        />
      </div>
    </section>
  );
};

export default OperationalMaturityCard;
