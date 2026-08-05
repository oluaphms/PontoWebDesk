import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { MasterTenantsService } from '../services/masterTenantsService';
import { MasterBackToDashboard } from '../components/MasterBackToDashboard';
import {
  INSTALLATION_TYPES,
  SAAS_WEB_URL,
  installationTypeFromMode,
  installationTypeLabel,
  modeFromInstallationType,
  parseInstallationType,
  planCycleFromInstallationType,
  type InstallationType,
} from '../commercial/installationType';
import { prepareCommercialFirstAccessPassword } from '../api/companiesApi';

const PLAN_OPTIONS = [
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'ANNUAL', label: 'Anual' },
] as const;

type FormState = {
  name: string;
  document: string;
  tradeName: string;
  adminName: string;
  adminEmail: string;
  domain: string;
  plan: string;
  installationType: InstallationType;
  status: string;
};

const emptyForm = (): FormState => ({
  name: '',
  document: '',
  tradeName: '',
  adminName: '',
  adminEmail: '',
  domain: '',
  plan: 'MONTHLY',
  installationType: 'SAAS_WEB',
  status: 'draft',
});

/**
 * Formulário Cadastrar / Editar empresa Master.
 * Fase 6.6 — tipo de instalação; pagamentos manuais (sem provedor).
 */
export function MasterCompanyFormPage() {
  const { companyId } = useParams<{ companyId?: string }>();
  const isEdit = Boolean(companyId);
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [temporaryPasswordExpiresAt, setTemporaryPasswordExpiresAt] = useState<string | null>(null);
  const [preparingPassword, setPreparingPassword] = useState(false);

  const availablePlans = useMemo(
    () =>
      PLAN_OPTIONS.filter(
        (p) => p.value === planCycleFromInstallationType(form.installationType),
      ),
    [form.installationType],
  );

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const row = await MasterTenantsService.get(companyId);
        if (cancelled) return;
        const installationType = parseInstallationType(
          row.installationType || installationTypeFromMode(row.modo),
        );
        setForm({
          name: row.empresa === 'Sem nome' ? '' : row.empresa,
          document: row.document || '',
          tradeName: row.tradeName || '',
          adminName: row.administrador === '—' ? '' : row.administrador,
          adminEmail: row.administradorEmail || '',
          domain: row.dominio === '—' ? '' : row.dominio,
          plan: planCycleFromInstallationType(installationType),
          installationType,
          status: row.status || 'draft',
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao carregar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      if (key === 'installationType') {
        const installationType = value as InstallationType;
        return {
          ...prev,
          installationType,
          plan: planCycleFromInstallationType(installationType),
          domain:
            installationType === 'SAAS_WEB' && !prev.domain.trim()
              ? SAAS_WEB_URL.replace(/^https?:\/\//, '')
              : prev.domain,
        };
      }
      return { ...prev, [key]: value };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const requiredCycle = planCycleFromInstallationType(form.installationType);
    if (form.plan !== requiredCycle) {
      setError(
        form.installationType === 'SAAS_WEB'
          ? 'SAAS_WEB permite somente plano mensal.'
          : 'ON_PREMISE permite somente plano anual.',
      );
      setSaving(false);
      return;
    }
    try {
      const mode = modeFromInstallationType(form.installationType);
      if (isEdit && companyId) {
        await MasterTenantsService.update(companyId, {
          company: {
            name: form.name.trim(),
            document: form.document.trim() || null,
            tradeName: form.tradeName.trim() || null,
          },
          admin: {
            name: form.adminName.trim(),
            email: form.adminEmail.trim(),
          },
          domain: form.domain.trim(),
          plan: form.plan,
          mode,
          installationType: form.installationType,
        });
        navigate(`/master/tenants/${companyId}`, { replace: true });
      } else {
        const created = await MasterTenantsService.create({
          company: {
            name: form.name.trim(),
            document: form.document.trim() || null,
            tradeName: form.tradeName.trim() || null,
          },
          admin: {
            name: form.adminName.trim(),
            email: form.adminEmail.trim(),
          },
          domain: form.domain.trim(),
          plan: form.plan,
          mode,
          status: form.status,
          installationType: form.installationType,
        });
        // Provisionamento completo: companies + comercial + admin.
        // Detalhe da empresa (não wizard) — já disponível no operacional.
        navigate(`/master/tenants/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function generateTemporaryPassword() {
    if (!companyId) return;
    setPreparingPassword(true);
    setError(null);
    try {
      const prepared = await prepareCommercialFirstAccessPassword(companyId);
      setTemporaryPassword(prepared.temporaryPassword);
      setTemporaryPasswordExpiresAt(prepared.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar senha provisória.');
    } finally {
      setPreparingPassword(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-wrap items-center gap-3">
        <MasterBackToDashboard />
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <Link
          to={isEdit && companyId ? `/master/tenants/${companyId}` : '/master/tenants'}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {isEdit ? 'Voltar à empresa' : 'Voltar às empresas'}
        </Link>
      </div>

      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
          Cadastro Master
        </p>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
          {isEdit ? 'Editar empresa' : 'Cadastrar empresa'}
        </h2>
        {isEdit ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Atualiza o cadastro comercial Master. Dados cadastrais operacionais continuam em companies.
          </p>
        ) : null}
      </header>

      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando…</p>}
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 border border-rose-500/20 bg-rose-500/10 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {!loading && (
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-border bg-surface shadow-card p-5 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="sm:col-span-2 space-y-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400">Nome *</span>
              <input
                required
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400">CNPJ</span>
              <input
                value={form.document}
                onChange={(e) => setField('document', e.target.value)}
                placeholder="00.000.000/0001-00"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400">Nome fantasia</span>
              <input
                value={form.tradeName}
                onChange={(e) => setField('tradeName', e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400">Administrador *</span>
              <input
                required
                value={form.adminName}
                onChange={(e) => setField('adminName', e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400">E-mail admin *</span>
              <input
                required
                type="email"
                value={form.adminEmail}
                onChange={(e) => setField('adminEmail', e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              />
              <span className="mt-1 block text-[10px] text-slate-500">
                A senha do administrador é definida na etapa “Criar administrador” da implantação
                (senha provisória opcional ou e-mail de primeiro acesso).
              </span>
            </label>
            <label className="sm:col-span-2 space-y-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400">Domínio *</span>
              <input
                required
                value={form.domain}
                onChange={(e) => setField('domain', e.target.value)}
                placeholder={
                  form.installationType === 'SAAS_WEB'
                    ? 'pontowebdesk.vercel.app'
                    : 'empresa.local'
                }
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              />
              {form.installationType === 'SAAS_WEB' && (
                <span className="mt-1 block text-[10px] text-slate-500">
                  URL SaaS: {SAAS_WEB_URL}
                </span>
              )}
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400">Tipo de instalação *</span>
              <select
                value={form.installationType}
                onChange={(e) => setField('installationType', parseInstallationType(e.target.value))}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              >
                {INSTALLATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {installationTypeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400">Plano</span>
              <select
                value={form.plan}
                onChange={(e) => setField('plan', e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              >
                {availablePlans.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[10px] text-slate-500">
                {form.installationType === 'SAAS_WEB'
                  ? 'SaaS Web: somente planos mensais.'
                  : 'On-premise: somente planos anuais.'}
              </span>
            </label>
            {!isEdit && (
              <label className="space-y-1.5">
                <span className="text-xs text-slate-600 dark:text-slate-400">Situação inicial</span>
                <select
                  value={form.status}
                  onChange={(e) => setField('status', e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
                >
                  <option value="draft">Rascunho</option>
                  <option value="active">Ativo</option>
                  <option value="trial">Teste</option>
                </select>
              </label>
            )}
          </div>

          {isEdit && companyId && (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                SENHA PROVISÓRIA DO PRIMEIRO ACESSO
              </p>
              <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
                Gera uma senha temporária segura para o administrador da empresa. A senha é exibida
                uma única vez e deve ser alterada após o primeiro login.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void generateTemporaryPassword()}
                  disabled={preparingPassword}
                  className="rounded-xl border border-amber-600/40 px-3 py-1.5 text-xs text-amber-900 disabled:opacity-40 dark:text-amber-200"
                >
                  {preparingPassword ? 'Gerando…' : 'Gerar / regenerar senha provisória'}
                </button>
                {temporaryPassword && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(temporaryPassword).catch((err) => {
                        setError(
                          err instanceof Error ? err.message : 'Falha ao copiar senha provisória',
                        );
                      });
                    }}
                    className="rounded-xl border border-amber-600/40 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200"
                  >
                    Copiar senha
                  </button>
                )}
              </div>
              {temporaryPassword && (
                <div className="mt-2 rounded-lg border border-amber-600/30 bg-white/70 px-3 py-2 text-xs text-amber-900 dark:bg-slate-900/40 dark:text-amber-200">
                  <p>
                    Senha provisória: <strong>{temporaryPassword}</strong>
                  </p>
                  <p>
                    Expira em:{' '}
                    {temporaryPasswordExpiresAt
                      ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(temporaryPasswordExpiresAt))
                      : '—'}
                  </p>
                </div>
              )}
            </section>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-500/90 hover:bg-indigo-400 text-slate-950 font-medium px-4 py-2 text-sm disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
