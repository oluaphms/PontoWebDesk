import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { DatabaseBackup, Download } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState, Button } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';
import { i18n } from '../../../lib/i18n';
import {
  buildTenantBackupPayload,
  downloadTenantBackupJson,
  fetchCompanyBackupSettings,
  saveCompanyBackupSettings,
  type CompanyBackupSettings,
} from '../../services/tenantDataBackup.service';

function pad2(n: number): string {
  return String(Math.max(0, Math.min(99, n))).padStart(2, '0');
}

function toTimeInputValue(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseTimeInput(v: string): { hour: number; minute: number } {
  const [a, b] = v.split(':');
  const hour = Math.min(23, Math.max(0, Number.parseInt(a || '0', 10) || 0));
  const minute = Math.min(59, Math.max(0, Number.parseInt(b || '0', 10) || 0));
  return { hour, minute };
}

const AdminBackup: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly');
  const [weekday, setWeekday] = useState(1);
  const [timeStr, setTimeStr] = useState('02:00');
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured()) {
      setLoadingSettings(false);
      return;
    }
    setLoadingSettings(true);
    setMessage(null);
    try {
      const row = await fetchCompanyBackupSettings(user.companyId);
      if (row) {
        setAutoEnabled(row.auto_enabled);
        setFrequency(row.frequency);
        setWeekday(Number.isFinite(row.weekday) ? row.weekday : 1);
        setTimeStr(toTimeInputValue(row.hour, row.minute));
        setLastRunAt(row.last_run_at);
      } else {
        setAutoEnabled(false);
        setFrequency('weekly');
        setWeekday(1);
        setTimeStr('02:00');
        setLastRunAt(null);
      }
    } catch {
      setMessage({ type: 'error', text: i18n.t('backup.loadError') });
    } finally {
      setLoadingSettings(false);
    }
  }, [user?.companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) {
      setMessage({ type: 'error', text: i18n.t('backup.exportError') });
      return;
    }
    setExportBusy(true);
    setMessage(null);
    try {
      const payload = await buildTenantBackupPayload(user.companyId);
      downloadTenantBackupJson(payload);
      setMessage({ type: 'success', text: i18n.t('backup.exportDone') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : i18n.t('backup.exportError');
      setMessage({ type: 'error', text: msg });
    } finally {
      setExportBusy(false);
    }
  };

  const handleSaveSchedule = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) {
      setMessage({ type: 'error', text: i18n.t('backup.saveError') });
      return;
    }
    const { hour, minute } = parseTimeInput(timeStr);
    const payload: CompanyBackupSettings = {
      company_id: user.companyId,
      auto_enabled: autoEnabled,
      frequency,
      weekday,
      hour,
      minute,
      last_run_at: lastRunAt,
    };
    setSaveBusy(true);
    setMessage(null);
    try {
      await saveCompanyBackupSettings(payload);
      setMessage({ type: 'success', text: i18n.t('backup.saved') });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : i18n.t('backup.saveError');
      setMessage({ type: 'error', text: msg });
    } finally {
      setSaveBusy(false);
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  const weekdayOptions = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    value: d,
    label: i18n.t(`backup.weekday${d}`),
  }));

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6 max-w-3xl">
        <PageHeader
          title={i18n.t('backup.title')}
          subtitle={i18n.t('backup.intro')}
          icon={<DatabaseBackup className="w-7 h-7 text-indigo-600 dark:text-indigo-400" aria-hidden />}
        />

        {message && (
          <div
            className={`p-4 rounded-xl text-sm ${
              message.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Download className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden />
            {i18n.t('backup.manualTitle')}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{i18n.t('backup.manualDesc')}</p>
          <Button type="button" onClick={() => void handleExport()} loading={exportBusy} disabled={exportBusy || loadingSettings}>
            {exportBusy ? i18n.t('backup.exporting') : i18n.t('backup.exportButton')}
          </Button>
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-6 shadow-sm space-y-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('backup.scheduleTitle')}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{i18n.t('backup.scheduleDesc')}</p>

          {loadingSettings ? (
            <p className="text-sm text-slate-500">{i18n.t('backup.exporting')}</p>
          ) : (
            <>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={autoEnabled}
                  onChange={(e) => setAutoEnabled(e.target.checked)}
                />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{i18n.t('backup.autoEnabled')}</span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{i18n.t('backup.frequency')}</label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value === 'daily' ? 'daily' : 'weekly')}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="daily">{i18n.t('backup.frequencyDaily')}</option>
                    <option value="weekly">{i18n.t('backup.frequencyWeekly')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{i18n.t('backup.time')}</label>
                  <input
                    type="time"
                    value={timeStr}
                    onChange={(e) => setTimeStr(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {frequency === 'weekly' && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{i18n.t('backup.weekday')}</label>
                  <select
                    value={weekday}
                    onChange={(e) => setWeekday(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {weekdayOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-4">
                <span className="font-semibold text-slate-600 dark:text-slate-300">{i18n.t('backup.lastRun')}: </span>
                {lastRunAt
                  ? new Date(lastRunAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                  : i18n.t('backup.lastRunNever')}
              </div>

              <Button type="button" variant="outline" onClick={() => void handleSaveSchedule()} loading={saveBusy} disabled={saveBusy}>
                {saveBusy ? i18n.t('backup.saving') : i18n.t('backup.save')}
              </Button>
            </>
          )}
        </section>
      </div>
    </RoleGuard>
  );
};

export default AdminBackup;
