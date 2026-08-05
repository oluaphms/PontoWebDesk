import React, { useEffect, useState } from 'react';
import { BellRing, Mail } from 'lucide-react';
import {
  fetchSubscriptionNotificationPreferences,
  updateSubscriptionNotificationPreferences,
  type SubscriptionNotificationPreferences,
} from '../api/subscriptionFinanceApi';

type EditablePreferences = Omit<
  SubscriptionNotificationPreferences,
  'tenantId' | 'companyId' | 'updatedAt'
>;

const DEFAULTS: EditablePreferences = {
  receiveEmail: true,
  notifyDueIn7: true,
  notifyDueIn3: true,
  notifyDueToday: true,
  notifyAfterBlock: true,
};

function PreferenceCheckbox({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
      />
      <span>
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

export function MasterSubscriptionNotificationPreferences({
  companyId,
  canWrite,
}: {
  companyId: string;
  canWrite: boolean;
}) {
  const [preferences, setPreferences] = useState<EditablePreferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchSubscriptionNotificationPreferences(companyId)
      .then((value) => {
        if (cancelled) return;
        setPreferences({
          receiveEmail: value.receiveEmail,
          notifyDueIn7: value.notifyDueIn7,
          notifyDueIn3: value.notifyDueIn3,
          notifyDueToday: value.notifyDueToday,
          notifyAfterBlock: value.notifyAfterBlock,
        });
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Falha ao carregar preferências.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  function toggle(key: keyof EditablePreferences, value: boolean) {
    setSaved(false);
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const value = await updateSubscriptionNotificationPreferences(companyId, preferences);
      setPreferences({
        receiveEmail: value.receiveEmail,
        notifyDueIn7: value.notifyDueIn7,
        notifyDueIn3: value.notifyDueIn3,
        notifyDueToday: value.notifyDueToday,
        notifyAfterBlock: value.notifyAfterBlock,
      });
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar preferências.');
    } finally {
      setSaving(false);
    }
  }

  const disabled = loading || saving || !canWrite;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface shadow-card p-4 ">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-indigo-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Notificações automáticas
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Defina quais avisos o administrador desta empresa receberá.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Mail className="h-4 w-4" />
          E-mail {preferences.receiveEmail ? 'ativado' : 'desativado'}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <PreferenceCheckbox
          checked={preferences.receiveEmail}
          disabled={disabled}
          label="Receber e-mail"
          description={preferences.receiveEmail ? 'Sim' : 'Não'}
          onChange={(value) => toggle('receiveEmail', value)}
        />
        <PreferenceCheckbox
          checked={preferences.notifyDueIn7}
          disabled={disabled}
          label="Receber aviso 7 dias antes"
          onChange={(value) => toggle('notifyDueIn7', value)}
        />
        <PreferenceCheckbox
          checked={preferences.notifyDueIn3}
          disabled={disabled}
          label="Receber aviso 3 dias antes"
          onChange={(value) => toggle('notifyDueIn3', value)}
        />
        <PreferenceCheckbox
          checked={preferences.notifyDueToday}
          disabled={disabled}
          label="Receber aviso no vencimento"
          onChange={(value) => toggle('notifyDueToday', value)}
        />
        <PreferenceCheckbox
          checked={preferences.notifyAfterBlock}
          disabled={disabled}
          label="Receber aviso após bloqueio"
          onChange={(value) => toggle('notifyAfterBlock', value)}
        />
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {saved && <p className="text-xs text-emerald-600">Preferências salvas.</p>}

      {canWrite && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void save()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar notificações'}
          </button>
        </div>
      )}
    </section>
  );
}
