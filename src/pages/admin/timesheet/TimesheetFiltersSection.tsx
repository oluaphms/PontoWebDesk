import React from 'react';
import { Button } from '../../../../components/UI';
import { RefreshCw } from 'lucide-react';
import { SkeletonFiltro } from '../../../components/TimesheetTableSkeleton';

export type TimesheetFiltersSectionProps = {
  loadingFiltros: boolean;
  employeesCount: number;
  departments: { id: string; name: string }[];
  filteredEmployees: { id: string; nome: string }[];
  filterDepartmentId: string;
  filterUserId: string;
  periodStart: string;
  periodEnd: string;
  todayMax: string;
  periodValid: boolean;
  loadingEspelho: boolean;
  recalculatingEspelho: boolean;
  companyId: string;
  onDepartmentChange: (id: string) => void;
  onUserChange: (id: string) => void;
  onPeriodStartChange: (v: string) => void;
  onPeriodEndChange: (v: string) => void;
  onRefreshEspelho: () => void;
};

export function TimesheetFiltersSection({
  loadingFiltros,
  employeesCount,
  departments,
  filteredEmployees,
  filterDepartmentId,
  filterUserId,
  periodStart,
  periodEnd,
  todayMax,
  periodValid,
  loadingEspelho,
  recalculatingEspelho,
  companyId,
  onDepartmentChange,
  onUserChange,
  onPeriodStartChange,
  onPeriodEndChange,
  onRefreshEspelho,
}: TimesheetFiltersSectionProps) {
  return (
    <>
      {/* FILTROS — layout original (departamento → colaborador → período) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-sm backdrop-blur-sm print:border print:shadow-none">
        <div className="px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filtros</h2>
        </div>
        {loadingFiltros && employeesCount === 0 ? (
          <SkeletonFiltro />
        ) : (
          <div className="p-4 flex flex-wrap gap-4 items-end">
            <div className="min-w-[200px] flex-1">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Departamento</label>
              <select
                value={filterDepartmentId}
                onChange={(e) => {
                  onDepartmentChange(e.target.value);
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              >
                <option value="">Todos</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[220px] flex-1">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Colaborador</label>
              <select
                value={filterUserId}
                onChange={(e) => onUserChange(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              >
                <option value="">Selecione o colaborador</option>
                {filteredEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Período (início)</label>
              <input
                type="date"
                value={periodStart}
                max={todayMax}
                onChange={(e) => onPeriodStartChange(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Período (fim)</label>
              <input
                type="date"
                value={periodEnd}
                max={todayMax}
                onChange={(e) => onPeriodEndChange(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              />
            </div>
            {!periodValid && (periodStart || periodEnd) && (
              <p className="w-full text-xs text-amber-700 dark:text-amber-300">
                Informe início e fim, com início ≤ fim, e datas não posteriores a hoje.
              </p>
            )}
            {!periodStart && !periodEnd && (
              <p className="w-full text-xs text-slate-500 dark:text-slate-400">
                Selecione o período para carregar os registros do espelho.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="inline-flex items-center gap-2 shrink-0"
              disabled={!periodValid || loadingEspelho || recalculatingEspelho || !companyId || !filterUserId}
              title="Recarrega batidas e recalcula hora extra / banco de horas do período (útil após REP, reconciliação ou ajuste manual)"
              onClick={() => {
                void onRefreshEspelho();
              }}
            >
              <RefreshCw
                className={`w-4 h-4 ${loadingEspelho || recalculatingEspelho ? 'animate-spin' : ''}`}
                aria-hidden
              />
              Atualizar batidas
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
