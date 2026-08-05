import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { detectOperationalMisuse } from '../../help/helpMisuseDetector';
import { openHelp } from '../../help/openHelp';
import { logHelpRoi } from '../../help/helpRoi';
import type { OperationalBundle } from '../../hooks/useOperationalBundle';

interface MisuseWarningsPanelProps {
  bundle: OperationalBundle;
}

export const MisuseWarningsPanel: React.FC<MisuseWarningsPanelProps> = ({ bundle }) => {
  const navigate = useNavigate();

  const warnings = useMemo(
    () =>
      detectOperationalMisuse({
        alerts: bundle.alerts,
        status: bundle.status,
        tasks: bundle.tasks,
        risk: bundle.risk,
        insights: bundle.insights,
        totalEmployees: bundle.totalEmployees,
      }),
    [bundle],
  );

  if (warnings.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/20 overflow-hidden">
      <div className="px-5 py-3 border-b border-amber-100 dark:border-amber-900/40 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600" />
        <h3 className="text-sm font-bold text-amber-900 dark:text-amber-100">Alertas de uso</h3>
      </div>
      <ul className="divide-y divide-amber-100 dark:divide-amber-900/30">
        {warnings.map((w) => (
          <li key={w.id} className="px-5 py-3">
            <p className="text-sm text-amber-950 dark:text-amber-50">⚠️ {w.message}</p>
            <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">{w.recommendation}</p>
            <button
              type="button"
              onClick={() => {
                logHelpRoi('resolver_click');
                openHelp(w.doc, navigate, { section: w.section, resolveSection: true });
              }}
              className="mt-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:underline"
            >
              Ver recomendação
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default MisuseWarningsPanel;
