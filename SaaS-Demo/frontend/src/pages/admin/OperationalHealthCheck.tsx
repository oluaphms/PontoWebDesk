import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button, LoadingState } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { resolveTenantId } from '../../services/tenantScope';
import {
  auditOperationalConsistency,
  type OperationalConsistencyAudit,
} from '../../domain/operational/consistency/distributedConsistencyAudit';

const OperationalHealthCheck: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [audit, setAudit] = useState<OperationalConsistencyAudit | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companyId = resolveTenantId(user) || '';

  const runAudit = useCallback(async () => {
    if (!supabase || !companyId) return;
    setRunning(true);
    setError(null);
    try {
      const result = await auditOperationalConsistency(supabase, companyId);
      setAudit(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao executar health-check operacional.');
    } finally {
      setRunning(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    void runAudit();
  }, [companyId, runAudit]);

  if (!isSupabaseConfigured()) return <Navigate to="/" replace />;
  if (loading) return <LoadingState message="Carregando health-check..." />;
  if (user && user.role !== 'admin' && user.role !== 'hr') return <Navigate to="/dashboard-admin" replace />;

  return (
    <div className="min-h-screen bg-slate-50/80 dark:bg-slate-950">
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <PageHeader
          title="Operational Health Check"
          subtitle="Score operacional em tempo real para drift, órfãos, replay, GEO e isolamento tenant."
          icon={<Activity className="w-6 h-6" />}
        />

        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => void runAudit()} disabled={running}>
            {running ? 'Executando...' : 'Reexecutar health-check'}
          </Button>
          {audit ? <span className="text-sm text-slate-500">Status: {audit.status}</span> : null}
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {running && !audit ? (
          <LoadingState message="Executando auditoria distribuída..." />
        ) : null}

        {audit ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
              <p className="text-xs uppercase tracking-wide text-slate-500">Score operacional</p>
              <p className="text-4xl font-semibold mt-2">{audit.score}</p>
              <p className="text-sm text-slate-500 mt-1">Classificação: {audit.status}</p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
                Achados de consistência ({audit.findings.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/70">
                    <tr>
                      <th className="px-3 py-2 text-left">Código</th>
                      <th className="px-3 py-2 text-left">Severidade</th>
                      <th className="px-3 py-2 text-left">Contagem</th>
                      <th className="px-3 py-2 text-left">Mensagem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.findings.map((f) => (
                      <tr key={`${f.code}-${f.message}`} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2 font-mono text-xs">{f.code}</td>
                        <td className="px-3 py-2">{f.severity}</td>
                        <td className="px-3 py-2">{f.count}</td>
                        <td className="px-3 py-2">{f.message}</td>
                      </tr>
                    ))}
                    {audit.findings.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-slate-500" colSpan={4}>
                          Nenhum achado crítico na janela auditada.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default OperationalHealthCheck;
