import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon } from 'lucide-react';
import type { RegressionAlert } from '../../help/helpRegressionDetector';
import { openHelp } from '../../help/openHelp';
import type { HelpDocSlug } from '../../help/helpCenterCatalog';

interface RegressionAlertBannerProps {
  alert: RegressionAlert;
}

export const RegressionAlertBanner: React.FC<RegressionAlertBannerProps> = ({ alert }) => {
  const navigate = useNavigate();

  return (
    <section
      className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
        alert.severity === 'critical'
          ? 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30'
          : 'border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30'
      }`}
    >
      <div className="flex items-start gap-3 flex-1">
        <AlertOctagon
          className={`w-5 h-5 shrink-0 mt-0.5 ${alert.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}`}
        />
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            {alert.severity === 'critical' ? '🔴' : '🟠'} {alert.title}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{alert.detail}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() =>
          openHelp(alert.doc as HelpDocSlug, navigate, { section: alert.section, resolveSection: true })
        }
        className="shrink-0 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Ver o que aconteceu →
      </button>
    </section>
  );
};

export default RegressionAlertBanner;
