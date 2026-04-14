import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { auth } from '../../services/supabaseClient';
import { ThemeService } from '../../../services/themeService';
import type { Theme } from '../../../services/themeService';
import { useSettings } from '../../contexts/SettingsContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { validatePassword } from '../../utils/passwordValidation';
import { i18n } from '../../../lib/i18n';
import { Lock, Globe2, Bell, Sun, Moon, Monitor, Info } from 'lucide-react';

const APP_VERSION = '1.4.0';

const EmployeeSettings: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const { settings: globalSettings } = useSettings();
  const { language: _appLang, setLanguage: setAppLanguage } = useLanguage();
  void _appLang;
  const [language, setLanguage] = useState('pt-BR');
  const [theme, setTheme] = useState<Theme>('auto');
  const [notifications, setNotifications] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    setLanguage(user.preferences?.language ?? 'pt-BR');
    setNotifications(user.preferences?.notifications ?? true);
    const savedTheme =
      (user.preferences?.theme as Theme) ??
      (typeof window !== 'undefined' ? ThemeService.readStoredTheme() : null) ??
      'auto';
    setTheme(savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'auto' ? savedTheme : 'auto');
  }, [user]);

  const applyThemeAndSave = (newTheme: Theme) => {
    setTheme(newTheme);
    ThemeService.applyTheme(newTheme);
  };

  const handleSavePreferences = async () => {
    if (!user || !isSupabaseConfigured) return;
    setSaving(true);
    setMessage(null);
    try {
      const prefs = {
        ...user.preferences,
        language,
        theme,
        notifications,
      };
      await db.update('users', user.id, {
        preferences: prefs,
        updated_at: new Date().toISOString(),
      });
      try {
        const existing = (await db.select('user_settings', [
          { column: 'user_id', operator: 'eq', value: user.id },
          { column: 'key', operator: 'eq', value: 'preferences' },
        ])) as any[];
        const row = existing?.[0];
        if (row) {
          await db.update('user_settings', row.id, {
            value: prefs,
            updated_at: new Date().toISOString(),
          });
        } else {
          await db.insert('user_settings', {
            id: crypto.randomUUID(),
            user_id: user.id,
            key: 'preferences',
            value: prefs,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      } catch {
        // user_settings pode não existir em todos os ambientes
      }
      ThemeService.applyTheme(theme);
      const lang = language === 'en-US' || language === 'pt-BR' ? language : 'pt-BR';
      setAppLanguage(lang);
      setMessage({ type: 'success', text: i18n.t('empSettings.prefsSaved') });
    } catch (e) {
      setMessage({ type: 'error', text: i18n.t('empSettings.prefsError') });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword) {
      setMessage({ type: 'error', text: i18n.t('empSettings.enterNewPassword') });
      return;
    }
    const pv = validatePassword(newPassword, globalSettings);
    if (!pv.valid) {
      setMessage({ type: 'error', text: pv.message || i18n.t('empSettings.passwordRequirements') });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: i18n.t('empSettings.passwordsDontMatch') });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await auth.updatePassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setMessage({ type: 'success', text: i18n.t('empSettings.passwordChanged') });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || i18n.t('empSettings.passwordError') });
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
      <PageHeader title={i18n.t('settings.title')} subtitle={i18n.t('empSettings.subtitle')} />

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

      <div className="space-y-8 max-w-xl">
        {/* Alterar senha */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Lock className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('empSettings.changePassword')}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{i18n.t('empSettings.changePasswordDesc')}</p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{i18n.t('empSettings.newPassword')}</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{i18n.t('empSettings.confirmPassword')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            <button
              type="button"
              onClick={handleChangePassword}
              disabled={saving}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white font-medium hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
            >
              {i18n.t('empSettings.changePassword')}
            </button>
          </div>
        </section>

        {/* Preferências */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Globe2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('empSettings.languageAppearance')}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{i18n.t('empSettings.languageAppearanceDesc')}</p>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{i18n.t('settings.language')}</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={inputClass}
              >
                <option value="pt-BR">{i18n.t('settings.languagePt')}</option>
                <option value="en-US">{i18n.t('settings.languageEn')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{i18n.t('empSettings.theme')}</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyThemeAndSave('light')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    theme === 'light'
                      ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Sun className="w-4 h-4" />
                  {i18n.t('empSettings.themeLight')}
                </button>
                <button
                  type="button"
                  onClick={() => applyThemeAndSave('dark')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    theme === 'dark'
                      ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Moon className="w-4 h-4" />
                  {i18n.t('empSettings.themeDark')}
                </button>
                <button
                  type="button"
                  onClick={() => applyThemeAndSave('auto')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    theme === 'auto'
                      ? 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Monitor className="w-4 h-4" />
                  {i18n.t('empSettings.themeAuto')}
                </button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {i18n.t('empSettings.autoThemeHelp')}
              </p>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={notifications}
                onChange={(e) => setNotifications(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <Bell className="w-5 h-5 text-slate-500" />
              <span className="text-slate-900 dark:text-white font-medium">{i18n.t('empSettings.notifications')}</span>
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 pl-8">
              {i18n.t('empSettings.notificationsHelp')}
            </p>
            <button
              type="button"
              onClick={handleSavePreferences}
              disabled={saving}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {i18n.t('empSettings.savePrefs')}
            </button>
          </div>
        </section>

        {/* Sobre */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Info className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('empSettings.aboutTitle')}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{i18n.t('empSettings.aboutDesc')}</p>
            </div>
          </div>
          <div className="p-6 space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {i18n.t('empSettings.aboutText')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {i18n.t('empSettings.version')} <span className="font-mono font-medium">{APP_VERSION}</span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {i18n.t('empSettings.appDescription')}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default EmployeeSettings;
