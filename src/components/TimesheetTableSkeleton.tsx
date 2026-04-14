import React from 'react';

const ADMIN_HEADERS = [
  'Colaborador',
  'Data',
  'Entrada (início)',
  'Intervalo (pausa)',
  'Retorno',
  'Saída (final)',
  'Horas trabalhadas',
  'Localização',
  'Status',
] as const;

const EMPLOYEE_HEADERS = [
  'Data',
  'Entrada (início)',
  'Intervalo (pausa)',
  'Retorno',
  'Saída (final)',
  'Horas trabalhadas',
  'Locais (resumo)',
  'Status',
] as const;

/**
 * Placeholders para os filtros do espelho (colaborador, departamento, datas) antes dos dados chegarem.
 */
export function SkeletonFiltro() {
  const bar = (w: string) => (
    <div
      className="h-9 rounded-lg bg-slate-200/90 dark:bg-slate-700/80 animate-pulse"
      style={{ width: w }}
    />
  );
  return (
    <div
      className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 print:hidden"
      aria-busy="true"
      aria-label="Carregando filtros"
    >
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-slate-200/80 dark:bg-slate-700/80 animate-pulse" />
        {bar('180px')}
      </div>
      <div className="space-y-2">
        <div className="h-3 w-28 rounded bg-slate-200/80 dark:bg-slate-700/80 animate-pulse" />
        {bar('180px')}
      </div>
      <div className="space-y-2">
        <div className="h-3 w-28 rounded bg-slate-200/80 dark:bg-slate-700/80 animate-pulse" />
        {bar('150px')}
      </div>
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-slate-200/80 dark:bg-slate-700/80 animate-pulse" />
        {bar('150px')}
      </div>
      <div className="flex flex-wrap gap-2 items-center ml-auto">
        <div className="h-9 w-28 rounded-xl bg-slate-200/80 dark:bg-slate-700/80 animate-pulse" />
        <div className="h-9 w-32 rounded-xl bg-slate-200/80 dark:bg-slate-700/80 animate-pulse" />
      </div>
    </div>
  );
}

/**
 * Skeleton com a mesma estrutura da tabela do espelho de ponto (evita salto de layout no carregamento).
 */
export function TimesheetTableSkeleton({ variant }: { variant: 'admin' | 'employee' }) {
  const headers = variant === 'admin' ? ADMIN_HEADERS : EMPLOYEE_HEADERS;
  const rowCount = 7;

  return (
    <div
      className="overflow-x-auto overscroll-x-contain touch-pan-x rounded-xl border border-slate-100 dark:border-slate-800 md:border-0 animate-in fade-in duration-200"
      aria-busy="true"
      aria-label="Carregando espelho de ponto"
    >
      <table className={`w-full text-xs sm:text-sm ${variant === 'admin' ? 'min-w-[860px] md:min-w-0' : ''}`}>
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left px-4 py-3 font-bold text-slate-400 dark:text-slate-500"
                scope="col"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }).map((_, rowIdx) => (
            <tr key={rowIdx} className="border-b border-slate-100 dark:border-slate-800">
              {headers.map((h, colIdx) => (
                <td key={`${rowIdx}-${h}`} className="px-4 py-3 align-middle">
                  <div
                    className="h-3.5 rounded-md bg-slate-200/90 dark:bg-slate-700/80 animate-pulse"
                    style={{
                      width:
                        colIdx === 0
                          ? variant === 'admin'
                            ? '72%'
                            : '68%'
                          : colIdx === 1 && variant === 'admin'
                            ? '56%'
                            : '48%',
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
