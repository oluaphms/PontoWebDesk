/**
 * Configurações comerciais do dia a dia (FASE 31).
 * Sem painéis técnicos — gateway/flags/health continuam em /master/admin via URL.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings2, PackageOpen, User, MessageSquare, Layers, DatabaseBackup } from 'lucide-react';
import { getMasterSession } from '../api/masterApi';
import { MasterBackToDashboard } from '../components/MasterBackToDashboard';

const STORAGE_KEY = 'pwd_master_commercial_settings';

type CommercialSettings = {
  defaultPlan: string;
  firstAccessMessage: string;
};

function readSettings(): CommercialSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        defaultPlan: 'TRIAL',
        firstAccessMessage:
          'Bem-vindo ao PontoWebDesk. Defina sua senha no primeiro acesso para começar a usar o sistema.',
      };
    }
    const parsed = JSON.parse(raw) as Partial<CommercialSettings>;
    return {
      defaultPlan: String(parsed.defaultPlan || 'TRIAL'),
      firstAccessMessage: String(
        parsed.firstAccessMessage ||
          'Bem-vindo ao PontoWebDesk. Defina sua senha no primeiro acesso para começar a usar o sistema.',
      ),
    };
  } catch {
    return {
      defaultPlan: 'TRIAL',
      firstAccessMessage:
        'Bem-vindo ao PontoWebDesk. Defina sua senha no primeiro acesso para começar a usar o sistema.',
    };
  }
}

export function MasterSettingsPage() {
  const session = getMasterSession();
  const [settings, setSettings] = useState<CommercialSettings>(() => readSettings());
  const [saved, setSaved] = useState(false);
  const appVersion = import.meta.env.VITE_APP_VERSION?.trim() || '1.4.0';

  useEffect(() => {
    setSettings(readSettings());
  }, []);

  function save(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <MasterBackToDashboard />
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
          Administração
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Configurações
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Opções do dia a dia. Configurações técnicas permanecem disponíveis por URL direta.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface shadow-card p-4 ">
          <div className="mb-2 flex items-center gap-2 text-slate-500">
            <Layers className="h-4 w-4" />
            <span className="text-[11px] uppercase tracking-wide">Versão</span>
          </div>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">{appVersion}</p>
          <p className="mt-1 text-xs text-slate-500">PontoWebDesk Plataforma · Painel Master</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface shadow-card p-4 ">
          <div className="mb-2 flex items-center gap-2 text-slate-500">
            <User className="h-4 w-4" />
            <span className="text-[11px] uppercase tracking-wide">Usuário Master</span>
          </div>
          <p className="truncate text-lg font-semibold text-slate-900 dark:text-white">
            {session?.name || 'Master'}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">{session?.email || '—'}</p>
          <p className="mt-1 text-xs text-indigo-600 dark:text-indigo-300">{session?.role || '—'}</p>
        </div>
      </div>

      <form
        onSubmit={save}
        className="space-y-4 rounded-2xl border border-border bg-surface shadow-card p-5 "
      >
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <Settings2 className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Preferências comerciais</h3>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Plano padrão</span>
          <select
            value={settings.defaultPlan}
            onChange={(e) => setSettings((s) => ({ ...s, defaultPlan: e.target.value }))}
            className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            {[
              { value: 'MONTHLY', label: 'Mensal' },
              { value: 'ANNUAL', label: 'Anual' },
            ].map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
            <MessageSquare className="h-3.5 w-3.5" />
            Mensagem de primeiro acesso
          </span>
          <textarea
            value={settings.firstAccessMessage}
            onChange={(e) => setSettings((s) => ({ ...s, firstAccessMessage: e.target.value }))}
            rows={4}
            className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Salvar
          </button>
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Salvo.</span>}
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/master/updates"
          className="flex items-start gap-3 rounded-2xl border border-border bg-surface shadow-card p-4 transition-colors hover:border-indigo-300  dark:hover:border-indigo-500/40"
        >
          <PackageOpen className="mt-0.5 h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Atualizações</p>
            <p className="mt-0.5 text-xs text-slate-500">Central de versões e clientes</p>
          </div>
        </Link>
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface shadow-card p-4 ">
          <DatabaseBackup className="mt-0.5 h-5 w-5 text-slate-500" />
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Cópia de segurança</p>
            <p className="mt-0.5 text-xs text-slate-500">
              A cópia de segurança operacional permanece no ambiente / VPS. Sem alteração nesta fase.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MasterSettingsPage;
