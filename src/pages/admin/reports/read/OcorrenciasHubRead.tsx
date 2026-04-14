import React from 'react';
import { Link } from 'react-router-dom';
import { ReportReadShell } from './ReportReadShell';

const ITEMS = [
  { label: 'Absenteísmo', to: '/admin/reports/read/absenteismo', desc: 'Consolidado de faltas e ausências' },
  { label: 'Batidas rejeitadas', to: '/admin/reports/read/batidas-rejeitadas', desc: 'Segurança e padrões suspeitos' },
  { label: 'Funções', to: '/admin/reports/read/funcoes', desc: 'Cargos e funções (leitura)' },
  { label: 'Inconsistências', to: '/admin/reports/read/inconsistencias', desc: 'Relatório analítico de ponto' },
  { label: 'Afastamentos', to: '/admin/reports/read/afastamentos', desc: 'Ausências e afastamentos' },
];

export function OcorrenciasHubRead() {
  return (
    <ReportReadShell title="Ocorrências" subtitle="Escolha o tipo de ocorrência para leitura.">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ITEMS.map((i) => (
          <li key={i.to}>
            <Link
              to={i.to}
              className="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-4 hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors"
            >
              <span className="font-semibold text-slate-900 dark:text-white">{i.label}</span>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{i.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </ReportReadShell>
  );
}
