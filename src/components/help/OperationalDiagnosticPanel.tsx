import React from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { Activity, CheckCircle2, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  type OperationalDiagnosticItem,
  type DiagnosticSeverity,
} from '../../help/helpDiagnosticEngine';
import { openHelp } from '../../help/openHelp';
import { trackHelpAnalytics } from '../../help/helpAnalytics';
import { logHelpRoi } from '../../help/helpRoi';
import type { OperationalBundle } from '../../hooks/useOperationalBundle';

interface OperationalDiagnosticPanelProps {
  bundle: OperationalBundle;
  maxItems?: number;
  viewAllHref?: string;
}

const SEVERITY_UI: Record<
  DiagnosticSeverity,
  { emoji: string; border: string; badge: string }
> = {
  critical: {
    emoji: '🔴',
    border: 'border-red-200 dark:border-red-900/50',
    badge: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  },
  warning: {
    emoji: '🟠',
    border: 'border-amber-200 dark:border-amber-900/50',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  },
  info: {
    emoji: '🔵',
    border: 'border-slate-200 dark:border-slate-700',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

export const OperationalDiagnosticPanel: React.FC<OperationalDiagnosticPanelProps> = ({
  bundle,
  maxItems,
  viewAllHref,
}) => {
  const navigate = useNavigate();
  const { diagnostics, isLoading } = bundle;

  if (isLoading && diagnostics.length === 0) {
    return <div className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-800/50 animate-pulse" aria-hidden />;
  }

  if (diagnostics.length === 0) {
    return (
      <section className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Diagnóstico do sistema</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              Nenhum problema operacional detectado no momento.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const visible = maxItems ? diagnostics.slice(0, maxItems) : diagnostics.slice(0, 6);

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
        <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Diagnóstico do sistema</h3>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {visible.map((item) => (
          <DiagnosticRow key={item.id} item={item} onFix={() => handleFix(item, navigate)} />
        ))}
      </ul>
      {viewAllHref && diagnostics.length > visible.length && (
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          <Link
            to={viewAllHref}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Ver diagnóstico completo
            <ChevronRight size={16} />
          </Link>
        </div>
      )}
    </section>
  );
};

function handleFix(item: OperationalDiagnosticItem, navigate: NavigateFunction) {
  trackHelpAnalytics('insight_clicked', { insightId: item.id, doc: item.solutionDoc });
  logHelpRoi('resolver_click');
  openHelp(item.solutionDoc, navigate, { section: item.section, resolveSection: true });
}

function DiagnosticRow({ item, onFix }: { item: OperationalDiagnosticItem; onFix: () => void }) {
  const ui = SEVERITY_UI[item.severity];
  return (
    <li className={`px-5 py-4 ${ui.border} border-l-4`}>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        {ui.emoji} Problema detectado: {item.problem}
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
        <span className="font-medium">Impacto:</span> {item.impact}
      </p>
      <button
        type="button"
        onClick={onFix}
        className="mt-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Ver como corrigir →
      </button>
    </li>
  );
}

export default OperationalDiagnosticPanel;
