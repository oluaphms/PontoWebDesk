import React from 'react';
import { Link } from 'react-router-dom';
import { ReportReadShell } from './ReportReadShell';

const ITEMS = [
  { label: 'Números provisórios', to: '/admin/reports/read/numeros-provisorios' },
  { label: 'Histórico de horários', to: '/admin/reports/read/historico-horarios' },
  { label: 'Histórico de centro de custos', to: '/admin/reports/read/historico-centro-custos' },
];

export function QuadroHorariosHubRead() {
  return (
    <ReportReadShell title="Quadro de horários" subtitle="Sub-relatórios do quadro.">
      <ul className="space-y-2 max-w-lg">
        {ITEMS.map((i) => (
          <li key={i.to}>
            <Link
              to={i.to}
              className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-4 py-3 text-slate-900 dark:text-white font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {i.label}
              <span className="text-slate-400">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </ReportReadShell>
  );
}
