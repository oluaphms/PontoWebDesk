import React, { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';
import { getSupabaseClient, isSupabaseConfigured } from '../../services/supabaseClient';
import { TrendingUp, Building2, Users, Clock } from 'lucide-react';

type TenantSnapshot = {
  employeesActive: number;
  punchesToday: number;
  usersInCompany: number;
};

export default function AdminMetricasProduto() {
  const { user, loading } = useCurrentUser();
  const [snap, setSnap] = useState<TenantSnapshot | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loadingSnap, setLoadingSnap] = useState(true);

  const companyId = user?.companyId;

  const load = useCallback(async () => {
    if (!companyId || !isSupabaseConfigured()) {
      setSnap(null);
      setLoadingSnap(false);
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      setLoadErr('Modo offline ativo — dados serão sincronizados depois.');
      setLoadingSnap(false);
      return;
    }
    setLoadingSnap(true);
    setLoadErr(null);
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const startIso = start.toISOString();

      const [empRes, punchRes, allUsersRes] = await Promise.all([
        client
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('role', 'employee')
          .eq('status', 'active'),
        client
          .from('time_records')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .gte('created_at', startIso),
        client.from('users').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'active'),
      ]);

      if (empRes.error) throw empRes.error;
      if (punchRes.error) throw punchRes.error;
      if (allUsersRes.error) throw allUsersRes.error;

      setSnap({
        employeesActive: empRes.count ?? 0,
        punchesToday: punchRes.count ?? 0,
        usersInCompany: allUsersRes.count ?? 0,
      });
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : 'Erro ao carregar métricas');
      setSnap(null);
    } finally {
      setLoadingSnap(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState message="Carregando…" />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-8 max-w-4xl">
        <PageHeader
          title="Métricas do produto"
          subtitle="Resumo da sua empresa (RLS). Métricas globais da plataforma estão disponíveis para operação via GET /api/admin/saas-metrics com API_KEY."
        />

        {loadErr && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
            {loadErr}
          </div>
        )}

        {loadingSnap ? (
          <LoadingState message="A carregar contagens…" />
        ) : snap ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-5 flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Colaboradores ativos</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{snap.employeesActive}</p>
                <p className="text-xs text-slate-500 mt-1">Papel employee + status active</p>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-5 flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Utilizadores ativos (empresa)</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{snap.usersInCompany}</p>
                <p className="text-xs text-slate-500 mt-1">Todos os papéis com status active</p>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-5 flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Batidas hoje</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{snap.punchesToday}</p>
                <p className="text-xs text-slate-500 mt-1">time_records desde 00:00 hora local</p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-6 space-y-2">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-medium">
            <TrendingUp className="w-5 h-5" />
            Métricas globais (operadores)
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Chamada autenticada com a mesma <code className="text-xs bg-slate-200 dark:bg-slate-700 px-1 rounded">API_KEY</code> dos
            outros endpoints <code className="text-xs bg-slate-200 dark:bg-slate-700 px-1 rounded">/api/admin/*</code>:{' '}
            <strong>GET /api/admin/saas-metrics</strong> — devolve empresas ativas (últimos 30 dias), utilizadores ativos no
            projeto e batidas no dia (UTC), usando a service role no servidor.
          </p>
        </div>

      </div>
    </RoleGuard>
  );
}
