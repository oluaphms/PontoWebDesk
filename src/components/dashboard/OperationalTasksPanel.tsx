import React, { memo, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { apiQueryKeys } from '../../lib/apiQueryKeys';
import { invalidateOperationalStatusQueries } from '../../lib/reactQueryInvalidation';
import { completeOperationalTask, fetchOperationalTasks, type OperationalTaskRow } from '../../services/operationalTasks.service';

const PRIORITY_UI: Record<string, { label: string; className: string }> = {
  critical: {
    label: 'Crítico',
    className: 'bg-red-600 text-white dark:bg-red-700',
  },
  high: {
    label: 'Alto',
    className: 'bg-orange-500 text-white dark:bg-orange-600',
  },
  medium: {
    label: 'Médio',
    className: 'bg-amber-400 text-amber-950 dark:bg-amber-500 dark:text-amber-950',
  },
  low: {
    label: 'Baixo',
    className: 'bg-slate-300 text-slate-800 dark:bg-slate-600 dark:text-slate-100',
  },
};

function taskTypeLabel(t: string): string {
  const labels: Record<string, string> = {
    missing_exit: 'Sem saída',
    long_break: 'Pausa longa',
    rep_pending: 'REP pendente',
    inconsistency: 'Inconsistência',
    excess_hours: 'Jornada excessiva',
  };
  return labels[t] ?? t;
}

export interface OperationalTasksPanelProps {
  companyId: string;
}

const OperationalTasksPanel = memo(function OperationalTasksPanel({ companyId }: OperationalTasksPanelProps) {
  const qk = apiQueryKeys.operationalTasks(companyId);

  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: qk,
    queryFn: () => fetchOperationalTasks(companyId),
    enabled: !!companyId.trim(),
    refetchInterval: 10_000,
  });

  const completeMutation = useMutation({
    mutationFn: completeOperationalTask,
    onSuccess: () => {
      invalidateOperationalStatusQueries(companyId);
    },
  });

  const onComplete = useCallback(
    (id: string) => {
      completeMutation.mutate(id);
    },
    [completeMutation],
  );

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white dark:bg-indigo-700">
          <ListChecks className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Tarefas operacionais</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Ações sugeridas a partir de alertas (não concluídas)</p>
        </div>
      </div>

      {isLoading && <div className="h-36 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" aria-busy="true" />}

      {isError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {(error as Error)?.message || 'Erro ao carregar tarefas.'}
        </p>
      )}

      {!isLoading && !isError && data.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma tarefa pendente no momento.</p>
      )}

      {!isLoading && !isError && data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Colaborador</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Prioridade</th>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.map((row: OperationalTaskRow) => {
                const pr = PRIORITY_UI[row.priority] ?? PRIORITY_UI.low;
                return (
                  <tr key={row.id} className="bg-white dark:bg-slate-900/30">
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                      {row.employee_name?.trim() ||
                        (row.employee_id ? `${row.employee_id.slice(0, 8)}…` : '—')}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{taskTypeLabel(row.task_type)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${pr.className}`}>
                        {pr.label}
                      </span>
                    </td>
                    <td className="max-w-xs px-3 py-2 text-slate-600 dark:text-slate-300">
                      {row.title?.trim() || row.description?.trim() || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={completeMutation.isPending}
                        onClick={() => onComplete(row.id)}
                        className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                        title="Concluir tarefa"
                      >
                        ✅ Concluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});

export default OperationalTasksPanel;
