import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { getSettings, updateSettings } from '../../services/settingsService';
import { useSettings } from '../../contexts/SettingsContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { i18n } from '../../../lib/i18n';
import { LoadingState } from '../../../components/UI';
import {
  MapPin,
  Camera,
  Clock,
  Globe2,
  Bell,
  Shield,
  CalendarClock,
  Keyboard,
} from 'lucide-react';

const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília (GMT-3)' },
  { value: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (GMT-3)' },
  { value: 'America/Recife', label: 'Recife (GMT-3)' },
];

const AdminSettings: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const { settings: globalSettings, refreshSettings } = useSettings();
  const { language: _appLang, setLanguage: setAppLanguage } = useLanguage();
  void _appLang; // re-render quando idioma mudar
  const [form, setForm] = useState({
    gps_required: false,
    photo_required: false,
    allow_manual_punch: true,
    late_tolerance_minutes: 15,
    min_break_minutes: 60,
    timezone: 'America/Sao_Paulo',
    language: 'pt-BR',
    email_alerts: true,
    daily_email_summary: false,
    punch_reminder: true,
    password_min_length: 8,
    require_numbers: false,
    require_special_chars: false,
    session_timeout_minutes: 60,
    default_entry_time: '09:00',
    default_exit_time: '18:00',
    allow_time_bank: true,
  });
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingData(true);
      try {
        const data = await getSettings();
        if (data) {
          setSettingsId(data.id);
          setForm({
            gps_required: data.gps_required,
            photo_required: data.photo_required,
            allow_manual_punch: data.allow_manual_punch,
            late_tolerance_minutes: data.late_tolerance_minutes,
            min_break_minutes: data.min_break_minutes,
            timezone: data.timezone,
            language: data.language,
            email_alerts: data.email_alerts,
            daily_email_summary: data.daily_email_summary,
            punch_reminder: data.punch_reminder,
            password_min_length: data.password_min_length,
            require_numbers: data.require_numbers,
            require_special_chars: data.require_special_chars,
            session_timeout_minutes: data.session_timeout_minutes,
            default_entry_time: data.default_entry_time,
            default_exit_time: data.default_exit_time,
            allow_time_bank: data.allow_time_bank,
          });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [globalSettings?.id]);

  const handleSave = async () => {
    if (!settingsId) {
      setMessage({ type: 'error', text: i18n.t('settings.notLoaded') });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await updateSettings(settingsId, {
        gps_required: form.gps_required,
        photo_required: form.photo_required,
        allow_manual_punch: form.allow_manual_punch,
        late_tolerance_minutes: form.late_tolerance_minutes,
        min_break_minutes: form.min_break_minutes,
        timezone: form.timezone,
        language: form.language,
        email_alerts: form.email_alerts,
        daily_email_summary: form.daily_email_summary,
        punch_reminder: form.punch_reminder,
        password_min_length: form.password_min_length,
        require_numbers: form.require_numbers,
        require_special_chars: form.require_special_chars,
        session_timeout_minutes: form.session_timeout_minutes,
        default_entry_time: form.default_entry_time,
        default_exit_time: form.default_exit_time,
        allow_time_bank: form.allow_time_bank,
      });
      if (error) throw error;
      await refreshSettings();
      setAppLanguage((form.language === 'en-US' || form.language === 'pt-BR') ? form.language : 'pt-BR');
      setMessage({ type: 'success', text: i18n.t('settings.savedSuccess') });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || i18n.t('settings.saveErrorShort') });
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm';

  if (loading) return <LoadingState message={i18n.t('common.loading')} />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-8">
      <PageHeader
        title={i18n.t('settings.title')}
        subtitle={i18n.t('settings.subtitleAdmin')}
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

      {loadingData ? (
        <div className="p-8 text-center text-slate-500">{i18n.t('settings.loading')}</div>
      ) : (
        <div className="space-y-8 max-w-3xl">
          {/* Registro de ponto */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                <Clock className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('settings.punchSection')}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{i18n.t('settings.punchSectionDesc')}</p>
              </div>
            </div>
            <div className="p-6 space-y-5">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.gps_required}
                  onChange={(e) => setForm({ ...form, gps_required: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <MapPin className="w-5 h-5 text-slate-500" />
                <span className="text-slate-900 dark:text-white font-medium">{i18n.t('settings.gpsRequired')}</span>
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 pl-8">
                {i18n.t('settings.gpsRequiredHelp')}
              </p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.photo_required}
                  onChange={(e) => setForm({ ...form, photo_required: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <Camera className="w-5 h-5 text-slate-500" />
                <span className="text-slate-900 dark:text-white font-medium">{i18n.t('settings.photoRequired')}</span>
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 pl-8">
                {i18n.t('settings.photoRequiredHelp')}
              </p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allow_manual_punch}
                  onChange={(e) => setForm({ ...form, allow_manual_punch: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <Keyboard className="w-5 h-5 text-slate-500" />
                <span className="text-slate-900 dark:text-white font-medium">{i18n.t('settings.allowManualPunch')}</span>
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 pl-8">
                {i18n.t('settings.allowManualPunchHelp')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {i18n.t('settings.lateTolerance')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={form.late_tolerance_minutes}
                    onChange={(e) => setForm({ ...form, late_tolerance_minutes: Number(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-500 mt-1">{i18n.t('settings.lateToleranceHelp')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {i18n.t('settings.minBreakMinutes')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={form.min_break_minutes}
                    onChange={(e) => setForm({ ...form, min_break_minutes: Number(e.target.value) || 0 })}
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-500 mt-1">{i18n.t('settings.minBreakHelp')}</p>
                </div>
              </div>
            </div>
          </section>

          {/* Geral */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
                <Globe2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('settings.general')}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{i18n.t('settings.timezone')} & {i18n.t('settings.language')}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{i18n.t('settings.timezone')}</label>
                <select
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  className={inputClass}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{i18n.t('settings.language')}</label>
                <select
                  value={form.language}
                  onChange={(e) => {
                    const lang = (e.target.value === 'en-US' || e.target.value === 'pt-BR') ? e.target.value : 'pt-BR';
                    setForm((f) => ({ ...f, language: lang }));
                    setAppLanguage(lang);
                  }}
                  className={inputClass}
                >
                  <option value="pt-BR">{i18n.t('settings.languagePt')}</option>
                  <option value="en-US">{i18n.t('settings.languageEn')}</option>
                </select>
              </div>
            </div>
          </section>

          {/* Notificações */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('settings.notifications')}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{i18n.t('settings.notificationsSubtitle')}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.email_alerts} onChange={(e) => setForm({ ...form, email_alerts: e.target.checked })} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-slate-900 dark:text-white font-medium">{i18n.t('settings.emailAlerts')}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.daily_email_summary} onChange={(e) => setForm({ ...form, daily_email_summary: e.target.checked })} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-slate-900 dark:text-white font-medium">{i18n.t('settings.dailySummary')}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.punch_reminder} onChange={(e) => setForm({ ...form, punch_reminder: e.target.checked })} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-slate-900 dark:text-white font-medium">{i18n.t('settings.punchReminder')}</span>
              </label>
            </div>
          </section>

          {/* Segurança */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('settings.security')}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{i18n.t('settings.securitySubtitle')}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{i18n.t('settings.minPasswordLength')}</label>
                <input type="number" min={6} max={32} value={form.password_min_length} onChange={(e) => setForm({ ...form, password_min_length: Number(e.target.value) || 6 })} className={inputClass} />
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.require_numbers} onChange={(e) => setForm({ ...form, require_numbers: e.target.checked })} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-slate-900 dark:text-white font-medium">{i18n.t('settings.requireNumbers')}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.require_special_chars} onChange={(e) => setForm({ ...form, require_special_chars: e.target.checked })} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-slate-900 dark:text-white font-medium">{i18n.t('settings.requireSpecialChars')}</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{i18n.t('settings.sessionTimeoutMinutes')}</label>
                <input type="number" min={15} max={480} value={form.session_timeout_minutes} onChange={(e) => setForm({ ...form, session_timeout_minutes: Number(e.target.value) || 15 })} className={inputClass} />
              </div>
            </div>
          </section>

          {/* Jornada */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <CalendarClock className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('settings.standardDay')}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{i18n.t('settings.standardDayDesc')}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{i18n.t('settings.defaultEntryTime')}</label>
                  <input type="time" value={form.default_entry_time} onChange={(e) => setForm({ ...form, default_entry_time: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{i18n.t('settings.defaultExitTime')}</label>
                  <input type="time" value={form.default_exit_time} onChange={(e) => setForm({ ...form, default_exit_time: e.target.value })} className={inputClass} />
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.allow_time_bank} onChange={(e) => setForm({ ...form, allow_time_bank: e.target.checked })} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-slate-900 dark:text-white font-medium">{i18n.t('settings.allowTimeBank')}</span>
              </label>
            </div>
          </section>

          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? i18n.t('settings.saving') : i18n.t('settings.saveAll')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSettings;
