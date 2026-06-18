import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BookOpen, Info } from 'lucide-react';
import {
  buildHelpInsightsFromContext,
  fetchHelpInsights,
  type HelpInsight,
} from '../../help/helpInsightsEngine';
import { openHelp } from '../../help/openHelp';
import { trackHelpAnalytics } from '../../help/helpAnalytics';

interface OperationalHelpInsightsProps {
  companyId: string;
  totalEmployees?: number;
}

export const OperationalHelpInsights: React.FC<OperationalHelpInsightsProps> = ({
  companyId,
  totalEmployees = 0,
}) => {
  const navigate = useNavigate();
  const [insights, setInsights] = useState<HelpInsight[]>(() =>
    buildHelpInsightsFromContext({ totalEmployees }),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchHelpInsights(companyId)
      .then((remote) => {
        if (cancelled) return;
        const base = buildHelpInsightsFromContext({ totalEmployees });
        const merged = [...base];
        for (const r of remote) {
          if (!merged.some((m) => m.id === r.id)) merged.push(r);
        }
        setInsights(merged.slice(0, 5));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, totalEmployees]);

  if (loading && insights.length === 0) {
    return <div className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-800/50 animate-pulse" aria-hidden />;
  }

  if (insights.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Sugestões do manual</h3>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {insights.map((item) => {
          const Icon = item.severity === 'warning' ? AlertTriangle : Info;
          return (
            <li key={item.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    item.severity === 'warning' ? 'text-amber-500' : 'text-indigo-500'
                  }`}
                />
                <p className="text-sm text-slate-700 dark:text-slate-300">{item.message}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  trackHelpAnalytics('insight_clicked', { insightId: item.id, doc: item.doc });
                  openHelp(item.doc, navigate, { section: item.section, resolveSection: true });
                }}
                className="shrink-0 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Como corrigir
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default OperationalHelpInsights;
