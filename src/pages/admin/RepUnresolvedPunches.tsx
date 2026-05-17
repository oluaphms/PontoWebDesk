/**
 * Quarentena: batidas REP sem colaborador resolvido — vinculação manual + promote.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, Link2, RefreshCw } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { linkUnresolvedRepPunchAndPromote } from '../../../modules/rep-integration/repService';
import {
  REP_PUNCH_LOG_EMBED_COLUMNS,
  REP_UNRESOLVED_PUNCH_COLUMNS,
} from '../../services/egressSelectColumns';
import { LoadingState } from '../../../components/UI';
import { i18n } from '../../../lib/i18n';

type PunchLog = {
  id: string;
  data_hora: string;
  nsr: number | null;
  pis: string | null;
  cpf: string | null;
  matricula: string | null;
  nome_funcionario: string | null;
  tipo_marcacao: string | null;
  rep_device_id: string | null;
  raw_data: Record<string, unknown> | null;
};

type QuarantineRow = {
  id: string;
  company_id: string;
  rep_punch_log_id: string;
  created_at: string;
  resolved_at: string | null;
  manually_linked_user_id: string | null;
  rep_punch_logs: PunchLog | PunchLog[] | null;
};

type EmployeeOption = { id: string; nome: string | null };

function asPunchLog(raw: QuarantineRow['rep_punch_logs']): PunchLog | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

const AdminRepUnresolvedPunches: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<QuarantineRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [pickUserByLog, setPickUserByLog] = useState<Record<string, string>>({});
  const [busyLogId, setBusyLogId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!user?.companyId || !supabase) return;
    setLoadingData(true);
    setMessage(null);
    try {
      const { data: quarantine, error: qErr } = await supabase
        .from('rep_unresolved_punches')
        .select(`${REP_UNRESOLVED_PUNCH_COLUMNS}, rep_punch_logs(${REP_PUNCH_LOG_EMBED_COLUMNS})`)
        .eq('company_id', user.companyId.trim())
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (qErr) throw qErr;

      const { data: em, error: eErr } = await supabase
        .from('users')
        .select('id, nome')
        .eq('company_id', user.companyId.trim())
        .order('nome', { ascending: true })
        .limit(3000);

      if (eErr) throw eErr;

      setRows((quarantine as QuarantineRow[]) || []);
      setEmployees((em as EmployeeOption[]) || []);
    } catch (e) {
      console.error(e);
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : i18n.t('repUnresolved.loadError'),
      });
      setRows([]);
    } finally {
      setLoadingData(false);
    }
  }, [user?.companyId]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    void load();
  }, [user?.companyId, load]);

  const linkAndPromote = async (repPunchLogId: string) => {
    const uid = pickUserByLog[repPunchLogId]?.trim();
    if (!uid || !user?.companyId || !supabase) {
      setMessage({ type: 'err', text: i18n.t('repUnresolved.pickEmployee') });
      return;
    }
    setBusyLogId(repPunchLogId);
    setMessage(null);
    try {
      const res = await linkUnresolvedRepPunchAndPromote(supabase, user.companyId, repPunchLogId, uid);
      if (!res.success) {
        setMessage({ type: 'err', text: res.error || i18n.t('repUnresolved.linkFailed') });
        return;
      }
      setMessage({
        type: 'ok',
        text: `${i18n.t('repUnresolved.linkOk')} (${res.promoted ?? 0})`,
      });
      await load();
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : i18n.t('repUnresolved.linkFailed'),
      });
    } finally {
      setBusyLogId(null);
    }
  };

  const formatDt = (s: string | null | undefined) => {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleString('pt-BR');
    } catch {
      return s;
    }
  };

  if (loading) return <LoadingState message={i18n.t('common.loading')} />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={i18n.t('repUnresolved.title')}
        subtitle={i18n.t('repUnresolved.subtitle')}
        icon={<AlertTriangle size={24} />}
      />

      {message && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            message.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loadingData || !isSupabaseConfigured()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} />
          {i18n.t('repUnresolved.refresh')}
        </button>
      </div>

      {loadingData ? (
        <LoadingState message={i18n.t('repUnresolved.loading')} />
      ) : rows.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400 text-center py-12">{i18n.t('repUnresolved.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                <th className="px-3 py-2 font-semibold">{i18n.t('repUnresolved.colWhen')}</th>
                <th className="px-3 py-2 font-semibold">NSR</th>
                <th className="px-3 py-2 font-semibold">PIS / CPF</th>
                <th className="px-3 py-2 font-semibold">Identificadores extraídos</th>
                <th className="px-3 py-2 font-semibold">{i18n.t('repUnresolved.colBadge')}</th>
                <th className="px-3 py-2 font-semibold">{i18n.t('repUnresolved.colNameDevice')}</th>
                <th className="px-3 py-2 font-semibold">Raw data</th>
                <th className="px-3 py-2 font-semibold min-w-[220px]">{i18n.t('repUnresolved.colEmployee')}</th>
                <th className="px-3 py-2 font-semibold w-[1%]">{i18n.t('repUnresolved.colAction')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const log = asPunchLog(row.rep_punch_logs);
                const logId = row.rep_punch_log_id;
                const pisCpf = [log?.pis, log?.cpf].filter(Boolean).join(' / ') || '—';
                const nomeDev = log?.nome_funcionario || '—';
                const extracted = Array.isArray(log?.raw_data?.extracted_identifiers)
                  ? (log?.raw_data?.extracted_identifiers as unknown[])
                      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                      .slice(0, 4)
                  : [];
                const rawPreview = log?.raw_data ? JSON.stringify(log.raw_data).slice(0, 160) : '—';
                return (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-100"
                  >
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDt(log?.data_hora)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{log?.nsr ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs max-w-[140px] truncate" title={pisCpf}>
                      {pisCpf}
                    </td>
                    <td
                      className="px-3 py-2 font-mono text-[11px] max-w-[220px] truncate"
                      title={extracted.join(', ') || '—'}
                    >
                      {extracted.length > 0 ? extracted.join(', ') : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{log?.matricula ?? '—'}</td>
                    <td className="px-3 py-2 max-w-[200px]">
                      <span className="line-clamp-2" title={nomeDev}>
                        {nomeDev}
                      </span>
                      {log?.rep_device_id && (
                        <span className="block text-[10px] text-slate-400 truncate" title={log.rep_device_id}>
                          {log.rep_device_id.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[260px] text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="line-clamp-3 font-mono" title={rawPreview}>
                        {rawPreview}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="w-full max-w-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                        value={pickUserByLog[logId] ?? ''}
                        onChange={(e) =>
                          setPickUserByLog((prev) => ({ ...prev, [logId]: e.target.value }))
                        }
                      >
                        <option value="">{i18n.t('repUnresolved.selectEmployee')}</option>
                        {employees.map((em) => (
                          <option key={em.id} value={em.id}>
                            {em.nome?.trim() || em.id.slice(0, 8)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={busyLogId === logId || !pickUserByLog[logId]}
                        onClick={() => void linkAndPromote(logId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        {busyLogId === logId ? '…' : i18n.t('repUnresolved.linkPromote')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminRepUnresolvedPunches;
