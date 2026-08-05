import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

type ReportReadShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  backTo?: string;
  actions?: React.ReactNode;
};

/**
 * Layout comum de “relatório para leitura”: título estilo ERP, data/hora de emissão, voltar.
 */
export function ReportReadShell({
  title,
  subtitle,
  children,
  backTo = '/admin/reports',
  actions,
}: ReportReadShellProps) {
  const emitido = useMemo(() => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }), []);

  return (
    <div className="min-h-full space-y-6 print:space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 print:hidden">
        <div>
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline mb-2"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar aos relatórios
          </Link>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
            Relatórios <span className="text-slate-300 dark:text-slate-600 font-light">|</span>{' '}
            <span className="font-extrabold tracking-tight">{title}</span>
          </h1>
          {subtitle && <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{subtitle}</p>}
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums">Emitido em {emitido}</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      </div>

      {/* Cabeçalho só na impressão */}
      <div className="hidden print:block border-b border-slate-300 pb-3 mb-4">
        <p className="text-center text-lg font-bold uppercase tracking-wide">Relatórios | {title}</p>
        <p className="text-center text-xs text-slate-600 mt-1">Emitido em {emitido}</p>
      </div>

      {children}
    </div>
  );
}
