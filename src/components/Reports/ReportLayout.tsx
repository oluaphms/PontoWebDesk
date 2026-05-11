import React from 'react';

interface ReportFilter {
  label: string;
  value: string;
}

interface ReportSummaryCard {
  label: string;
  value: string | number;
  unit?: string;
}

interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

/** Linha de dados da tabela do relatório (valores exibíveis). */
export type ReportLayoutRow = Record<
  string,
  string | number | boolean | null | undefined
>;

interface ReportLayoutProps {
  title: string;
  company: string;
  filters: ReportFilter[];
  summary: ReportSummaryCard[];
  columns: ReportColumn[];
  data: ReportLayoutRow[];
  children?: React.ReactNode;
}

export const ReportLayout: React.FC<ReportLayoutProps> = ({
  title,
  company,
  filters,
  summary,
  columns,
  data,
  children,
}) => {
  return (
    <div className="space-y-6 p-6 bg-white dark:bg-slate-900">
      {/* CABEÇALHO */}
      <div className="border-b border-slate-200 dark:border-slate-700 pb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
          {title}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Empresa: <span className="font-semibold">{company}</span>
        </p>

        {/* FILTROS */}
        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3">
            Filtros Aplicados
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filters.map((filter, idx) => (
              <div key={idx}>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {filter.label}
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {filter.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RESUMO (CARDS) */}
      {summary.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {summary.map((card, idx) => (
            <div
              key={idx}
              className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
                {card.label}
              </p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                {card.value}
              </p>
              {card.unit && (
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {card.unit}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* TABELA PRINCIPAL */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 dark:bg-slate-950">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-white font-semibold text-xs uppercase tracking-wide ${
                    col.align === 'center'
                      ? 'text-center'
                      : col.align === 'right'
                        ? 'text-right'
                        : 'text-left'
                  }`}
                  style={{ width: col.width }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={`border-b border-slate-200 dark:border-slate-700 ${
                  rowIdx % 2 === 0
                    ? 'bg-white dark:bg-slate-900'
                    : 'bg-slate-50 dark:bg-slate-800/50'
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={`${rowIdx}-${col.key}`}
                    className={`px-4 py-3 text-slate-900 dark:text-slate-100 ${
                      col.align === 'center'
                        ? 'text-center'
                        : col.align === 'right'
                          ? 'text-right'
                          : 'text-left'
                    }`}
                  >
                    {row[col.key] || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* CONTEÚDO ADICIONAL */}
      {children && <div>{children}</div>}

      {/* RODAPÉ */}
      <div className="text-xs text-slate-500 dark:text-slate-400 text-center pt-6 border-t border-slate-200 dark:border-slate-700">
        <p>
          Gerado em {new Date().toLocaleDateString('pt-BR')} às{' '}
          {new Date().toLocaleTimeString('pt-BR')}
        </p>
      </div>
    </div>
  );
};

export default ReportLayout;
