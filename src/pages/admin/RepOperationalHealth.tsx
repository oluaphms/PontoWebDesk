/**
 * Painel de saúde operacional REP — invariantes, zombies e manutenção (expiração / waiting_review).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button, LoadingState } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { resolveTenantId } from '../../services/tenantScope';
import {
  MAX_REPROMOTE_ATTEMPTS,
  REP_EXPIRE_AFTER_DAYS,
  ZOMBIE_PENDING_DAYS,
  computeRepOperationalHealth,
  detectZombieRepOperationalStates,
  emitRepGovernanceZombieIncidents,
  runRepGovernanceMaintenance,
  validateRepOperationalIntegrity,
  type RepGovernanceViolation,
  type RepOperationalHealth,
  type RepZombieSignal,
} from '../../services/repOperationalIntegrity.service';
import { applyRecoveryStressToOperationalHealth } from '../../domain/operational/health/operationalHealthEngine';
import { countOpenOperationalDeadLetters } from '../../services/operationalDeadLetter.service';

const RepOperationalHealthPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const companyId = useMemo(() => resolveTenantId(user) || '', [user]);

  const [health, setHealth] = useState<RepOperationalHealth | null>(null);
  const [violations, setViolations] = useState<RepGovernanceViolation[]>([]);
  const [zombies, setZombies] = useState<RepZombieSignal[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maintenanceMsg, setMaintenanceMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !companyId) return;
    setLoadingData(true);
    setError(null);
    try {
      const [v, z, statusRes, openDlq] = await Promise.all([
        validateRepOperationalIntegrity(supabase, companyId),
        detectZombieRepOperationalStates(supabase, companyId),
        supabase
          .from('rep_punch_logs')
          .select('operational_resolution_status')
          .eq('company_id', companyId)
          .is('time_record_id', null)
          .eq('ignored', false)
          .in('operational_resolution_status', ['pending', 'investigating', 'waiting_review']),
        countOpenOperationalDeadLetters(supabase, companyId),
      ]);

      if (statusRes.error) {
        throw new Error(statusRes.error.message);
      }

      const orows = (statusRes.data ?? []) as { operational_resolution_status: string }[];
      let open = 0;
      let waiting = 0;
      for (const r of orows) {
        open += 1;
        if (r.operational_resolution_status === 'waiting_review') waiting += 1;
      }

      const h = applyRecoveryStressToOperationalHealth(
        computeRepOperationalHealth({
          violationCount: v.length,
          zombieCount: z.length,
          waitingReviewCount: waiting,
          openOperationalCount: open,
        }),
        { openDlqCount: openDlq, orphanSampleHits: 0 },
      );

      setViolations(v);
      setZombies(z);
      setHealth(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar painel.');
    } finally {
      setLoadingData(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (companyId) void load();
  }, [companyId, load]);

  const runMaintenance = async () => {
    if (!supabase || !companyId) return;
    setMaintenanceBusy(true);
    setMaintenanceMsg(null);
    try {
      const { expired, waitingReview } = await runRepGovernanceMaintenance(supabase, companyId);
      const z2 = await detectZombieRepOperationalStates(supabase, companyId);
      await emitRepGovernanceZombieIncidents(supabase, companyId, z2);
      setMaintenanceMsg(
        `Manutenção concluída: ${expired} linha(s) expirada(s), ${waitingReview} promovida(s) a waiting_review, ${z2.length} sinal(is) zombie registrados na timeline.`,
      );
      await load();
    } catch (e) {
      setMaintenanceMsg(e instanceof Error ? e.message : 'Falha na manutenção.');
    } finally {
      setMaintenanceBusy(false);
    }
  };

  if (!isSupabaseConfigured()) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState message="A carregar…" />
      </div>
    );
  }

  if (user && user.role !== 'admin' && user.role !== 'hr') {
    return <Navigate to="/dashboard-admin" replace />;
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Saúde operacional REP"
        subtitle="Invariantes de reconciliação, limite de promotes e expiração de pendências."
        icon={ShieldCheck}
      />

      {!companyId ? (
        <p className="text-slate-600 dark:text-slate-400">Empresa não identificada na sessão.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 items-center">
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loadingData}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loadingData ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Button type="button" onClick={() => void runMaintenance()} disabled={maintenanceBusy || loadingData}>
              {maintenanceBusy ? 'A executar…' : 'Executar manutenção'}
            </Button>
          </div>

          {maintenanceMsg ? (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-4 py-3 text-sm text-slate-800 dark:text-slate-200">
              {maintenanceMsg}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {loadingData && !health ? (
            <LoadingState message="A carregar indicadores…" />
          ) : health ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
                <div className="text-sm text-slate-500 dark:text-slate-400">Pontuação (0–100)</div>
                <div className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {health.score}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
                <div className="text-sm text-slate-500 dark:text-slate-400">Pendências operacionais abertas</div>
                <div className="text-2xl font-semibold tabular-nums">{health.openOperationalRows}</div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
                <div className="text-sm text-slate-500 dark:text-slate-400">Em waiting_review</div>
                <div className="text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                  {health.waitingReview}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
                <div className="text-sm text-slate-500 dark:text-slate-400">Violações de integridade</div>
                <div className="text-2xl font-semibold tabular-nums text-red-700 dark:text-red-300">
                  {health.violations}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
                <div className="text-sm text-slate-500 dark:text-slate-400">Sinais zombie</div>
                <div className="text-2xl font-semibold tabular-nums text-orange-700 dark:text-orange-300">
                  {health.zombies}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/30 text-sm text-slate-600 dark:text-slate-400">
                <div className="font-medium text-slate-800 dark:text-slate-200 mb-2">Políticas ativas</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Máximo {MAX_REPROMOTE_ATTEMPTS} tentativas de promote → waiting_review</li>
                  <li>Pendência &gt; {ZOMBIE_PENDING_DAYS} dias → incidente REP_GOVERNANCE (após manutenção)</li>
                  <li>Expiração automática após {REP_EXPIRE_AFTER_DAYS} dias (dados preservados)</li>
                </ul>
              </div>
            </div>
          ) : null}

          {violations.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">Violações (amostra)</h2>
              <ul className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/40 text-sm max-h-72 overflow-y-auto">
                {violations.slice(0, 40).map((v, i) => (
                  <li key={`${v.code}-${v.rep_punch_log_id ?? i}`} className="px-4 py-2">
                    <span className="font-mono text-xs text-slate-500">{v.code}</span>
                    <div className="text-slate-800 dark:text-slate-200">{v.message}</div>
                    {v.rep_punch_log_id ? (
                      <div className="text-xs text-slate-500 mt-1">rep_punch_log: {v.rep_punch_log_id}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {zombies.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">Sinais zombie detectados</h2>
              <ul className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/40 text-sm max-h-60 overflow-y-auto">
                {zombies.slice(0, 30).map((z) => (
                  <li key={`${z.kind}-${z.rep_punch_log_id}`} className="px-4 py-2">
                    <span className="font-mono text-xs text-slate-500">{z.kind}</span>
                    <div className="text-slate-800 dark:text-slate-200">Log {z.rep_punch_log_id}</div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
};

export default RepOperationalHealthPage;
