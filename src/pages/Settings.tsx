import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shield, Bell, Cog, Globe2, MonitorPlay } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button, LoadingState } from '../../components/UI';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { useLanguage } from '../contexts/LanguageContext';
import { i18n } from '../../lib/i18n';

interface SettingsRecord {
  id: string;
  company_name: string | null;
  timezone: string | null;
  language: string | null;
  screenshot_interval: number | null;
  idle_detection: number | null;
  tracking_rules: string | null;
  email_alerts: boolean | null;
  system_alerts: boolean | null;
  daily_summary: boolean | null;
  password_policy_json: any;
  session_timeout: number | null;
  two_factor_enabled: boolean | null;
}

const SettingsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const { language: contextLanguage, setLanguage: setContextLanguage } = useLanguage();
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [form, setForm] = useState({
    companyName: '',
    timezone: 'America/Sao_Paulo',
    language: 'pt-BR',
    screenshotInterval: 5,
    idleDetection: 5,
    trackingRules: '',
    emailAlerts: true,
    systemAlerts: true,
    dailySummary: false,
    minPasswordLength: 8,
    requireNumbers: true,
    requireSpecialChars: false,
    sessionTimeout: 60,
    twoFactorEnabled: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      try {
        const rows =
          (await db.select('settings', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) ?? [];
        if (rows.length > 0) {
          const s = rows[0] as SettingsRecord;
          setSettings(s);
          const passwordPolicy = s.password_policy_json ?? {};
          const lang = (s.language === 'pt-BR' || s.language === 'en-US' ? s.language : 'pt-BR') as 'pt-BR' | 'en-US';
          setForm({
            companyName: s.company_name ?? '',
            timezone: s.timezone ?? 'America/Sao_Paulo',
            language: lang,
            screenshotInterval: s.screenshot_interval ?? 5,
            idleDetection: s.idle_detection ?? 5,
            trackingRules: s.tracking_rules ?? '',
            emailAlerts: s.email_alerts ?? true,
            systemAlerts: s.system_alerts ?? true,
            dailySummary: s.daily_summary ?? false,
            minPasswordLength: passwordPolicy.minLength ?? 8,
            requireNumbers: passwordPolicy.requireNumbers ?? true,
            requireSpecialChars: passwordPolicy.requireSpecialChars ?? false,
            sessionTimeout: s.session_timeout ?? 60,
            twoFactorEnabled: s.two_factor_enabled ?? false,
          });
          setContextLanguage(lang); // todo o sistema passa a usar o idioma salvo (sidebar, layout, etc.)
        }
      } catch (e) {
        console.error('Erro ao carregar settings:', e);
      }
    };

    load();
  }, [user, setContextLanguage]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isSupabaseConfigured) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        company_id: user.companyId,
        company_name: form.companyName || null,
        timezone: form.timezone,
        language: form.language,
        screenshot_interval: form.screenshotInterval,
        idle_detection: form.idleDetection,
        tracking_rules: form.trackingRules || null,
        email_alerts: form.emailAlerts,
        system_alerts: form.systemAlerts,
        daily_summary: form.dailySummary,
        password_policy_json: {
          minLength: form.minPasswordLength,
          requireNumbers: form.requireNumbers,
          requireSpecialChars: form.requireSpecialChars,
        },
        session_timeout: form.sessionTimeout,
        two_factor_enabled: form.twoFactorEnabled,
      };

      if (settings) {
        await (db as { update: (table: string, id: string, data: any) => Promise<any> }).update(
          'settings',
          settings.id,
          payload,
        );
      } else {
        const id = crypto.randomUUID();
        await (db as { insert: (table: string, data: any) => Promise<any> }).insert('settings', {
          id,
          ...payload,
        });
      }
    } catch (err) {
      console.error('Erro ao salvar settings:', err);
      setError(i18n.t('settings.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!settings) return;
    const passwordPolicy = settings.password_policy_json ?? {};
    setForm({
      companyName: settings.company_name ?? '',
      timezone: settings.timezone ?? 'America/Sao_Paulo',
      language: settings.language ?? 'pt-BR',
      screenshotInterval: settings.screenshot_interval ?? 5,
      idleDetection: settings.idle_detection ?? 5,
      trackingRules: settings.tracking_rules ?? '',
      emailAlerts: settings.email_alerts ?? true,
      systemAlerts: settings.system_alerts ?? true,
      dailySummary: settings.daily_summary ?? false,
      minPasswordLength: passwordPolicy.minLength ?? 8,
      requireNumbers: passwordPolicy.requireNumbers ?? true,
      requireSpecialChars: passwordPolicy.requireSpecialChars ?? false,
      sessionTimeout: settings.session_timeout ?? 60,
      twoFactorEnabled: settings.two_factor_enabled ?? false,
    });
  };

  const handleQuickLanguageChange = (lang: 'pt-BR' | 'en-US') => {
    setForm((f) => ({ ...f, language: lang }));
    setContextLanguage(lang); // atualiza o contexto para todo o sistema (sidebar, layout, etc.)
  };

  if (loading) {
    return <LoadingState message={i18n.t('settings.loading')} />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={i18n.t('settings.title')}
        subtitle={i18n.t('settings.subtitle')}
        icon={<Cog className="w-5 h-5" />}
      />

      <form onSubmit={handleSave} className="space-y-8">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-200 uppercase tracking-widest">
              {i18n.t('settings.general')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{i18n.t('settings.companyName')}</label>
              <input
                type="text"
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{i18n.t('settings.timezone')}</label>
              <select
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              >
                <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                <option value="America/Fortaleza">America/Fortaleza</option>
                <option value="America/Manaus">America/Manaus</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{i18n.t('settings.language')}</label>
              <div className="mt-1 flex items-center gap-2">
                <select
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  value={form.language}
                  onChange={(e) => handleQuickLanguageChange(e.target.value as 'pt-BR' | 'en-US')}
                >
                  <option value="pt-BR">{i18n.t('settings.languagePt')}</option>
                  <option value="en-US">{i18n.t('settings.languageEn')}</option>
                </select>
                <div className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => handleQuickLanguageChange('pt-BR')}
                    className={`px-3 py-1 text-[11px] font-semibold rounded-full ${
                      form.language === 'pt-BR'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-300'
                    }`}
                  >
                    PT
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickLanguageChange('en-US')}
                    className={`px-3 py-1 text-[11px] font-semibold rounded-full ${
                      form.language === 'en-US'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-300'
                    }`}
                  >
                    EN
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <MonitorPlay className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-200 uppercase tracking-widest">
              {i18n.t('settings.tracking')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {i18n.t('settings.screenshotInterval')}
              </label>
              <input
                type="number"
                min={1}
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={form.screenshotInterval}
                onChange={(e) => setForm((f) => ({ ...f, screenshotInterval: Number(e.target.value) || 1 }))}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {i18n.t('settings.idleDetection')}
              </label>
              <input
                type="number"
                min={1}
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={form.idleDetection}
                onChange={(e) => setForm((f) => ({ ...f, idleDetection: Number(e.target.value) || 1 }))}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{i18n.t('settings.trackingRules')}</label>
              <textarea
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                rows={3}
                value={form.trackingRules}
                onChange={(e) => setForm((f) => ({ ...f, trackingRules: e.target.value }))}
              />
            </div>
          </div>
        </section>

        <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-200 uppercase tracking-widest">
              {i18n.t('settings.notifications')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-slate-700 dark:text-slate-200">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.emailAlerts}
                onChange={(e) => setForm((f) => ({ ...f, emailAlerts: e.target.checked }))}
              />
              <span>{i18n.t('settings.emailAlerts')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.systemAlerts}
                onChange={(e) => setForm((f) => ({ ...f, systemAlerts: e.target.checked }))}
              />
              <span>{i18n.t('settings.systemAlerts')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.dailySummary}
                onChange={(e) => setForm((f) => ({ ...f, dailySummary: e.target.checked }))}
              />
              <span>{i18n.t('settings.dailySummary')}</span>
            </label>
          </div>
        </section>

        <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-200 uppercase tracking-widest">
              {i18n.t('settings.security')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {i18n.t('settings.minPasswordLength')}
              </label>
              <input
                type="number"
                min={6}
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={form.minPasswordLength}
                onChange={(e) => setForm((f) => ({ ...f, minPasswordLength: Number(e.target.value) || 6 }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{i18n.t('settings.passwordPolicy')}</label>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.requireNumbers}
                  onChange={(e) => setForm((f) => ({ ...f, requireNumbers: e.target.checked }))}
                />
                <span>{i18n.t('settings.requireNumbers')}</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.requireSpecialChars}
                  onChange={(e) => setForm((f) => ({ ...f, requireSpecialChars: e.target.checked }))}
                />
                <span>{i18n.t('settings.requireSpecialChars')}</span>
              </label>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {i18n.t('settings.sessionTimeout')}
                </label>
                <input
                  type="number"
                  min={15}
                  className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                  value={form.sessionTimeout}
                  onChange={(e) => setForm((f) => ({ ...f, sessionTimeout: Number(e.target.value) || 15 }))}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.twoFactorEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, twoFactorEnabled: e.target.checked }))}
                />
                <span>{i18n.t('settings.twoFactor')}</span>
              </label>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={handleReset}>
            {i18n.t('settings.reset')}
          </Button>
          <Button type="submit" size="sm" loading={saving}>
            {i18n.t('settings.save')}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SettingsPage;
