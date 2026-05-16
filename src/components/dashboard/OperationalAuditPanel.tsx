import React, { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { apiQueryKeys } from '../../lib/apiQueryKeys';
import { fetchOperationalAudit, type OperationalAuditRow } from '../../services/operationalAudit.service';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function actionLabel(action: string): string {
  const m: Record<string, string> = {
    created: 'Criou',
    resolved: 'Resolveu',
    updated: 'Atualizou',
    auto_resolved: 'Resolveu (automático)',
  };
  return m[action] ?? action;
}

function entityLabel(type: string): string {
  const m: Record<string, string> = {
    task: 'Tarefa',
    alert: 'Alerta',
    risk: 'Risco',
  };
  return m[type] ?? type;
}

export interface OperationalAuditPanelProps {
  companyId: string;
}

const OperationalAuditPanel = memo(function OperationalAuditPanel({ companyId }: OperationalAuditPanelProps) {
  const qk = apiQueryKeys.operationalAudit(companyId);

  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: qk,
    queryFn: () => fetchOperationalAudit(companyId, { limit: 100 }),
    enabled: !!companyId.trim(),
    refetchInterval: 30_000,
  });

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-700 text-white dark:bg-slate-600">
          <ScrollText className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Trilha de auditoria</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Histórico imutável de ações operacionais (compliance)</p>
        </div>
      </div>

      {isLoading && <div className="h-36 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" aria-busy="true" />}

      {isError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {(error as Error)?.message || 'Erro ao carregar auditoria.'}
        </p>
      )}

      {!isLoading && !isError && data.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum evento registado ainda.</p>
      )}

      {!isLoading && !isError && data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800 max-h-96 overflow-y-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800/95 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">Ação</th>
                <th className="px-3 py-2">Entidade</th>
                <th className="px-3 py-2">Utilizador</th>
                <th className="px-3 py-2">Detalhe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.map((row: OperationalAuditRow) => {
                const actor =
                  row.actor_name?.trim() ||
                  (row.actor_id ? `${row.actor_id.slice(0, 8)}…` : null);
                const userCell = actor ?? 'Sistema';
                const meta = row.metadata && Object.keys(row.metadata).length > 0 ? JSON.stringify(row.metadata) : '—';
                const entityIdShort = row.entity_id ? `${row.entity_id.slice(0, 8)}…` : '—';
                return (
                  <tr key={row.id} className="bg-white dark:bg-slate-900/30">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">{formatWhen(row.created_at)}</td>
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">{actionLabel(row.action)}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {entityLabel(row.entity_type)} <span className="text-xs text-slate-400">({entityIdShort})</span>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{userCell}</td>
                    <td className="max-w-xs truncate px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400" title={meta}>
                      {meta}
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

export default OperationalAuditPanel;
