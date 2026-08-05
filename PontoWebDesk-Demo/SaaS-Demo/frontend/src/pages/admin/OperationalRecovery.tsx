/**
 * Admin: recuperação operacional (DLQ, replay, órfãos) — explícito e auditável.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Activity, RefreshCw } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button, LoadingState } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { resolveTenantId } from '../../services/tenantScope';
import {
  detectOperationalOrphans,
  recoverPendingOperationalFailures,
  recoverSingleOperationalDeadLetter,
} from '../../domain/operational/recovery/operationalRecoveryEngine';
import { ignoreOperationalDeadLetter, listOperationalDeadLettersForCompany } from '../../services/operationalDeadLetter.service';
import type { OperationalDeadLetterRow } from '../../domain/operational/recovery/operationalDeadLetterQueue';
import {
  listTimeAttendanceTimelinePage,
  type TimeAttendanceTimelineRow,
} from '../../services/timeAttendanceTimeline.service';
import { TimeAttendanceTimelineEventType } from '../../services/timeAttendanceTimeline.constants';

const OperationalRecovery: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const companyId = useMemo(() => resolveTenantId(user) || '', [user]);

  const [rows, setRows] = useState<OperationalDeadLetterRow[]>([]);
  const [timeline, setTimeline] = useState<TimeAttendanceTimelineRow[]>([]);
  const [orphans, setOrphans] = useState<{ kind: string; incident_code?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !companyId) return;
    setErr(null);
    try {
      const [dlq, tl] = await Promise.all([
        listOperationalDeadLettersForCompany(supabase, companyId, { limit: 80 }),
        listTimeAttendanceTimelinePage({
          companyId,
          limit: 40,
          sourceModule: 'operational_recovery',
          supabaseClient: supabase,
        }),
      ]);
      setRows(dlq);
      setTimeline(tl.rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao carregar DLQ.');
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loading && user && user.role !== 'admin' && user.role !== 'hr') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  if (!isSupabaseConfigured()) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const runBatch = async () => {
    if (!supabase || !companyId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await recoverPendingOperationalFailures(supabase, companyId, {
        maxItems: 5,
        triggeredBy: user?.id ?? null,
      });
      setMsg(`Processados: ${r.processed} · recuperados: ${r.recovered} · reenfileirados: ${r.requeued} · falhas: ${r.failed}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro no worker de recovery.');
    } finally {
      setBusy(false);
    }
  };

  const runOrphans = async () => {
    if (!supabase || !companyId) return;
    setBusy(true);
    setErr(null);
    try {
      const o = await detectOperationalOrphans(supabase, companyId, { reviewLimit: 80 });
      setOrphans(o.map((x) => ({ kind: x.kind, incident_code: x.incident_code })));
      setMsg(`Varredura de órfãos: ${o.length} achado(s) (evento na timeline se > 0).`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro na detecção.');
    } finally {
      setBusy(false);
    }
  };

  const replayOne = async (id: string) => {
    if (!supabase || !companyId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await recoverSingleOperationalDeadLetter(supabase, companyId, id, { triggeredBy: user?.id ?? null });
      setMsg(r.ok ? `Replay: ${r.outcome ?? '—'}` : 'Não foi possível reivindicar o item (estado/cooldown).');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro no replay.');
    } finally {
      setBusy(false);
    }
  };

  const ignoreOne = async (id: string) => {
    if (!supabase || !companyId) return;
    setBusy(true);
    try {
      await ignoreOperationalDeadLetter(supabase, id, companyId);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <PageHeader
        title="Recuperação operacional"
        subtitle="DLQ de commits parciais, replay idempotente e detecção de órfãos (sem auto-promote)."
      />

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" disabled={busy || !companyId} onClick={() => void runBatch()}>
          <RefreshCw className="w-4 h-4 mr-1 inline" />
          Processar fila (até 5)
        </Button>
        <Button type="button" variant="secondary" disabled={busy || !companyId} onClick={() => void runOrphans()}>
          Detectar órfãos
        </Button>
        <Button type="button" variant="ghost" disabled={busy || !companyId} onClick={() => void load()}>
          Atualizar
        </Button>
        <Link
          to="/admin/time-attendance-timeline?module=operational_recovery"
          className="inline-flex items-center text-sm text-indigo-600 dark:text-indigo-400"
        >
          Abrir timeline (filtrar manualmente)
        </Link>
      </div>

      {!companyId ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">Empresa não identificada.</p>
      ) : null}
      {msg ? <p className="text-sm text-slate-700 dark:text-slate-300">{msg}</p> : null}
      {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      <div className="grid md:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4" /> Dead letter queue
          </h2>
          {busy && rows.length === 0 ? <LoadingState message="Carregando…" /> : null}
          <div className="overflow-x-auto text-xs">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2 pr-2">Estado</th>
                  <th className="py-2 pr-2">Etapa</th>
                  <th className="py-2 pr-2">Retries</th>
                  <th className="py-2 pr-2">operation_id</th>
                  <th className="py-2 pr-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-2 font-mono">{r.status}</td>
                    <td className="py-2 pr-2">{r.failed_stage}</td>
                    <td className="py-2 pr-2">{r.retry_count}</td>
                    <td className="py-2 pr-2 font-mono truncate max-w-[140px]" title={r.operation_id}>
                      {r.operation_id.slice(0, 8)}…
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        className="text-indigo-600 dark:text-indigo-400 disabled:opacity-50"
                        disabled={busy || r.status !== 'pending'}
                        onClick={() => void replayOne(r.id)}
                      >
                        Replay
                      </button>
                      <button
                        type="button"
                        className="text-slate-500 dark:text-slate-400 disabled:opacity-50"
                        disabled={busy || r.status === 'recovered'}
                        onClick={() => void ignoreOne(r.id)}
                      >
                        Ignorar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && !busy ? <p className="text-slate-500 py-4">Nenhum registo na DLQ.</p> : null}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold">Timeline de recovery</h2>
          <ul className="text-xs space-y-2 max-h-80 overflow-y-auto">
            {timeline.map((t) => (
              <li key={t.id} className="border-b border-slate-100 dark:border-slate-800 pb-2">
                <span className="font-mono text-slate-600 dark:text-slate-400">{t.created_at}</span>{' '}
                <span className="font-medium">{t.event_type}</span>
                {t.event_type === TimeAttendanceTimelineEventType.OPERATIONAL_ORPHAN_DETECTED ? (
                  <span className="text-amber-600 dark:text-amber-400 ml-1">órfão</span>
                ) : null}
              </li>
            ))}
          </ul>
          {timeline.length === 0 ? <p className="text-slate-500 text-xs">Sem eventos recentes do módulo operational_recovery.</p> : null}
        </section>
      </div>

      {orphans.length > 0 ? (
        <section className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-4">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2">Órfãos (amostra)</h2>
          <ul className="text-xs space-y-1 font-mono">
            {orphans.slice(0, 24).map((o, i) => (
              <li key={i}>
                {o.kind} {o.incident_code ? `· ${o.incident_code}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

export default OperationalRecovery;
