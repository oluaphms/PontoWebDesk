import React, { useEffect, useState } from 'react';
import { Bell, History, MessageSquare, Save } from 'lucide-react';
import {
  CRM_CHANNELS,
  CRM_PAYMENT_METHODS,
  CRM_SITUATIONS,
  createCrmAttendance,
  createCrmReminder,
  fetchTenantCrm,
  formatCrmDateTime,
  formatCrmMoney,
  saveTenantCrmProfile,
  setCrmReminderStatus,
  type CrmAttendance,
  type CrmAttendanceChannel,
  type CrmHistoryEvent,
  type CrmPaymentMethod,
  type CrmProfile,
  type CrmReminder,
  type CrmSituation,
} from '../api/crmApi';
import { MasterVisualTimeline } from './MasterVisualTimeline';
import { MasterStatusBadge } from './MasterStatusBadge';

const INPUT =
  'w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

type Props = {
  tenantId: string;
  seedName?: string;
  seedContact?: string;
  seedEmail?: string;
  seedPlan?: string;
};

function emptyProfile(tenantId: string, seed: Props): CrmProfile {
  return {
    masterTenantId: tenantId,
    companyName: seed.seedName ?? '',
    contactName: seed.seedContact ?? '',
    phone: null,
    whatsapp: null,
    email: seed.seedEmail ?? null,
    city: null,
    state: null,
    contractedPlan: seed.seedPlan ?? null,
    negotiatedAmountCents: null,
    paymentMethod: null,
    pixKey: null,
    dueDate: null,
    situation: 'prospect',
    notes: null,
    lastContactAt: null,
    deploymentDate: null,
    lastAccessAt: null,
    lastUpdateAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

/** Painel CRM no detalhe da empresa — Master only. */
export function MasterCompanyCrmPanel(props: Props) {
  const { tenantId } = props;
  const [profile, setProfile] = useState<CrmProfile>(() => emptyProfile(tenantId, props));
  const [history, setHistory] = useState<CrmHistoryEvent[]>([]);
  const [attendances, setAttendances] = useState<CrmAttendance[]>([]);
  const [reminders, setReminders] = useState<CrmReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [negotiatedReais, setNegotiatedReais] = useState('');

  const [attSubject, setAttSubject] = useState('');
  const [attBody, setAttBody] = useState('');
  const [attChannel, setAttChannel] = useState<CrmAttendanceChannel>('whatsapp');
  const [remTitle, setRemTitle] = useState('');
  const [remDue, setRemDue] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const snap = await fetchTenantCrm(tenantId);
      setProfile(snap.profile);
      setHistory(snap.history ?? []);
      setAttendances(snap.attendances ?? []);
      setReminders(snap.reminders ?? []);
      setNegotiatedReais(
        snap.profile.negotiatedAmountCents != null
          ? String(snap.profile.negotiatedAmountCents / 100)
          : '',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar CRM');
      setProfile(emptyProfile(tenantId, props));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function patch<K extends keyof CrmProfile>(key: K, value: CrmProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  async function saveProfile() {
    setBusy(true);
    setError(null);
    try {
      const cents = negotiatedReais.trim()
        ? Math.round(Number(negotiatedReais.replace(',', '.')) * 100)
        : null;
      const saved = await saveTenantCrmProfile(tenantId, {
        ...profile,
        negotiatedAmountCents: Number.isFinite(cents as number) ? cents : null,
      });
      setProfile(saved);
      const snap = await fetchTenantCrm(tenantId);
      setHistory(snap.history ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar perfil CRM');
    } finally {
      setBusy(false);
    }
  }

  async function addAttendance() {
    if (!attSubject.trim()) return;
    setBusy(true);
    try {
      await createCrmAttendance(tenantId, {
        channel: attChannel,
        subject: attSubject.trim(),
        body: attBody.trim() || undefined,
      });
      setAttSubject('');
      setAttBody('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar atendimento');
    } finally {
      setBusy(false);
    }
  }

  async function addReminder() {
    if (!remTitle.trim() || !remDue) return;
    setBusy(true);
    try {
      await createCrmReminder(tenantId, {
        title: remTitle.trim(),
        dueAt: new Date(remDue).toISOString(),
      });
      setRemTitle('');
      setRemDue('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar lembrete');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando CRM…</p>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">
          {error}
        </p>
      )}

      <section className="space-y-3 rounded-2xl border border-border bg-surface shadow-card p-4 ">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Perfil comercial</h3>
            <MasterStatusBadge status={profile.situation} />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveProfile()}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Salvar
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nome da empresa">
            <input className={INPUT} value={profile.companyName} onChange={(e) => patch('companyName', e.target.value)} />
          </Field>
          <Field label="Responsável">
            <input className={INPUT} value={profile.contactName} onChange={(e) => patch('contactName', e.target.value)} />
          </Field>
          <Field label="Telefone">
            <input className={INPUT} value={profile.phone ?? ''} onChange={(e) => patch('phone', e.target.value || null)} />
          </Field>
          <Field label="WhatsApp">
            <input className={INPUT} value={profile.whatsapp ?? ''} onChange={(e) => patch('whatsapp', e.target.value || null)} />
          </Field>
          <Field label="E-mail">
            <input className={INPUT} type="email" value={profile.email ?? ''} onChange={(e) => patch('email', e.target.value || null)} />
          </Field>
          <Field label="Cidade">
            <input className={INPUT} value={profile.city ?? ''} onChange={(e) => patch('city', e.target.value || null)} />
          </Field>
          <Field label="Estado (UF)">
            <input className={INPUT} maxLength={2} value={profile.state ?? ''} onChange={(e) => patch('state', e.target.value || null)} />
          </Field>
          <Field label="Plano contratado">
            <input className={INPUT} value={profile.contractedPlan ?? ''} onChange={(e) => patch('contractedPlan', e.target.value || null)} />
          </Field>
          <Field label="Valor negociado (R$)">
            <input className={INPUT} inputMode="decimal" value={negotiatedReais} onChange={(e) => setNegotiatedReais(e.target.value)} />
          </Field>
          <Field label="Forma de pagamento">
            <select
              className={INPUT}
              value={profile.paymentMethod ?? ''}
              onChange={(e) =>
                patch('paymentMethod', (e.target.value || null) as CrmPaymentMethod | null)
              }
            >
              <option value="">—</option>
              {CRM_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="PIX">
            <input className={INPUT} value={profile.pixKey ?? ''} onChange={(e) => patch('pixKey', e.target.value || null)} />
          </Field>
          <Field label="Data de vencimento">
            <input className={INPUT} type="date" value={profile.dueDate ?? ''} onChange={(e) => patch('dueDate', e.target.value || null)} />
          </Field>
          <Field label="Situação">
            <select
              className={INPUT}
              value={profile.situation}
              onChange={(e) => patch('situation', e.target.value as CrmSituation)}
            >
              {CRM_SITUATIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Último contato">
            <input
              className={INPUT}
              type="datetime-local"
              value={toLocalInput(profile.lastContactAt)}
              onChange={(e) =>
                patch('lastContactAt', e.target.value ? new Date(e.target.value).toISOString() : null)
              }
            />
          </Field>
          <Field label="Data da implantação">
            <input
              className={INPUT}
              type="date"
              value={profile.deploymentDate ?? ''}
              onChange={(e) => patch('deploymentDate', e.target.value || null)}
            />
          </Field>
          <Field label="Último acesso">
            <input
              className={INPUT}
              type="datetime-local"
              value={toLocalInput(profile.lastAccessAt)}
              onChange={(e) =>
                patch('lastAccessAt', e.target.value ? new Date(e.target.value).toISOString() : null)
              }
            />
          </Field>
          <Field label="Última atualização">
            <input
              className={INPUT}
              type="datetime-local"
              value={toLocalInput(profile.lastUpdateAt)}
              onChange={(e) =>
                patch('lastUpdateAt', e.target.value ? new Date(e.target.value).toISOString() : null)
              }
            />
          </Field>
          <Field label="Observações">
            <textarea
              className={`${INPUT} min-h-[80px]`}
              value={profile.notes ?? ''}
              onChange={(e) => patch('notes', e.target.value || null)}
            />
          </Field>
        </div>
        <p className="text-[11px] text-slate-500">
          Valor atual: {formatCrmMoney(profile.negotiatedAmountCents)} · Atualizado{' '}
          {formatCrmDateTime(profile.updatedAt)}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 rounded-2xl border border-border bg-surface shadow-card p-4 lg:col-span-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <MessageSquare className="h-4 w-4" /> Atendimento
          </h3>
          <select className={INPUT} value={attChannel} onChange={(e) => setAttChannel(e.target.value as CrmAttendanceChannel)}>
            {CRM_CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input className={INPUT} placeholder="Assunto" value={attSubject} onChange={(e) => setAttSubject(e.target.value)} />
          <textarea className={`${INPUT} min-h-[70px]`} placeholder="Detalhes" value={attBody} onChange={(e) => setAttBody(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => void addAttendance()} className="rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700">
            Registrar
          </button>
          <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
            {attendances.map((a) => (
              <li key={a.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <p className="font-medium text-slate-900 dark:text-white">{a.subject}</p>
                <p className="text-slate-500">{a.channel} · {formatCrmDateTime(a.attendedAt)}</p>
              </li>
            ))}
            {attendances.length === 0 && <li className="text-slate-500">Nenhum atendimento.</li>}
          </ul>
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-surface shadow-card p-4 lg:col-span-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Bell className="h-4 w-4" /> Lembretes
          </h3>
          <input className={INPUT} placeholder="Título" value={remTitle} onChange={(e) => setRemTitle(e.target.value)} />
          <input className={INPUT} type="datetime-local" value={remDue} onChange={(e) => setRemDue(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => void addReminder()} className="rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700">
            Criar lembrete
          </button>
          <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
            {reminders.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <p className="font-medium text-slate-900 dark:text-white">{r.title}</p>
                <p className="text-slate-500">{r.status} · {formatCrmDateTime(r.dueAt)}</p>
                {r.status === 'open' && (
                  <div className="mt-1 flex gap-1">
                    <button
                      type="button"
                      className="text-emerald-600"
                      onClick={() => {
                        void (async () => {
                          try {
                            await setCrmReminderStatus(tenantId, r.id, 'done');
                            await load();
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : 'Falha ao concluir lembrete',
                            );
                          }
                        })();
                      }}
                    >
                      Concluir
                    </button>
                    <button
                      type="button"
                      className="text-rose-600"
                      onClick={() => {
                        void (async () => {
                          try {
                            await setCrmReminderStatus(tenantId, r.id, 'cancelled');
                            await load();
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : 'Falha ao cancelar lembrete',
                            );
                          }
                        })();
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </li>
            ))}
            {reminders.length === 0 && <li className="text-slate-500">Nenhum lembrete.</li>}
          </ul>
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-surface shadow-card p-4 lg:col-span-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <History className="h-4 w-4" /> Histórico comercial
          </h3>
          <div className="max-h-80 overflow-y-auto pr-1">
            <MasterVisualTimeline
              empty="Sem eventos ainda."
              items={history.map((h) => ({
                id: h.id,
                title: h.title,
                detail: h.body,
                meta: h.eventType,
                at: `${formatCrmDateTime(h.createdAt)}${h.actorEmail ? ` · ${h.actorEmail}` : ''}`,
              }))}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
      {label}
      {children}
    </label>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
