import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Playback GEO operacional — histórico append-only (operational_state_history) + score forense.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { History, Loader2, Play } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button, LoadingState } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { db, getSupabaseClient, isSupabaseConfigured } from '../../services/supabaseClient';
import {
  OperationalGeoPlayback,
  type OperationalGeoClient,
  type OperationalGeoTrailPoint,
} from '../../domain/operational/geo/operationalGeoPlayback.service';

const OperationalGeoPlaybackPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [employees, setEmployees] = useState<{ id: string; nome: string }[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [fromYmd, setFromYmd] = useState(() => new Date().toISOString().slice(0, 10));
  const [toYmd, setToYmd] = useState(() => new Date().toISOString().slice(0, 10));
  const [trail, setTrail] = useState<OperationalGeoTrailPoint[]>([]);
  const [forensics, setForensics] = useState<{ geo_forensics_score: number; flags: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadEmployees = useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const rows = (await db.select(
      'users',
      [{ column: 'company_id', operator: 'eq', value: user.companyId }],
      { column: 'nome', ascending: true },
      500,
    )) as { id: string; nome?: string }[];
    setEmployees((rows ?? []).map((r) => ({ id: r.id, nome: r.nome ?? r.id })));
  }, [user?.companyId]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const runPlayback = useCallback(async () => {
    if (!user?.companyId || !employeeId) return;
    setBusy(true);
    setForensics(null);
    try {
      const fromIso = `${fromYmd}T00:00:00.000Z`;
      const toIso = `${toYmd}T23:59:59.999Z`;
      const { trail: t } = await OperationalGeoPlayback.loadTrail(
        user.companyId,
        employeeId,
        getSupabaseClient() as unknown as OperationalGeoClient | null,
        {
          fromIso,
          toIso,
          limit: 5000,
        },
      );
      setTrail(t);
      setForensics(OperationalGeoPlayback.analyzeTrail(t));
    } catch (e) {
      observabilityConsole.error(e);
    } finally {
      setBusy(false);
    }
  }, [user?.companyId, employeeId, fromYmd, toYmd]);

  const summary = useMemo(() => {
    if (trail.length < 2) return null;
    const first = trail[0]!;
    const last = trail[trail.length - 1]!;
    return { first: first.recordedAt, last: last.recordedAt, samples: trail.length };
  }, [trail]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto w-full min-w-0">
      <PageHeader title="Playback GEO operacional" subtitle="Histórico imutável (COS) + análise forense." icon={<History size={24} />} />

      <div className="flex flex-col md:flex-row gap-3 md:items-end flex-wrap bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-400">Colaborador</span>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 min-w-[220px]"
          >
            <option value="">Selecione…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-400">De</span>
          <input
            type="date"
            value={fromYmd}
            onChange={(e) => setFromYmd(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-400">Até</span>
          <input
            type="date"
            value={toYmd}
            onChange={(e) => setToYmd(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2"
          />
        </label>
        <Button type="button" variant="primary" disabled={!employeeId || busy} onClick={() => void runPlayback()} className="inline-flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Carregar trilha
        </Button>
      </div>

      {summary && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Amostras: {summary.samples} · {summary.first} → {summary.last}
        </p>
      )}

      {forensics && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-800/50">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Score forense: <span className="text-indigo-600 dark:text-indigo-400">{forensics.geo_forensics_score}</span>
          </p>
          {forensics.flags.length > 0 && (
            <ul className="mt-2 text-xs text-slate-600 dark:text-slate-400 list-disc list-inside">
              {forensics.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 dark:bg-slate-800 text-left">
            <tr>
              <th className="px-3 py-2">Registo</th>
              <th className="px-3 py-2">Lat</th>
              <th className="px-3 py-2">Lng</th>
              <th className="px-3 py-2">Precisão (m)</th>
              <th className="px-3 py-2">v estado</th>
            </tr>
          </thead>
          <tbody>
            {trail.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  Sem pontos com GEO no período (ou histórico ainda vazio).
                </td>
              </tr>
            ) : (
              trail.map((p, i) => (
                <tr key={`${p.recordedAt}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 whitespace-nowrap">{p.recordedAt}</td>
                  <td className="px-3 py-2 font-mono">{p.latitude.toFixed(5)}</td>
                  <td className="px-3 py-2 font-mono">{p.longitude.toFixed(5)}</td>
                  <td className="px-3 py-2">{p.accuracyMeters != null ? Math.round(p.accuracyMeters) : '—'}</td>
                  <td className="px-3 py-2">{p.stateVersion ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default memo(OperationalGeoPlaybackPage);
