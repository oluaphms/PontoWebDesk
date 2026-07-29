import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Copy,
  KeyRound,
  Rocket,
  ShieldAlert,
} from 'lucide-react';
import {
  fetchDeploymentWizard,
  runDeploymentWizardStep,
  fetchCommercialJourney,
  type CommercialJourney,
  type DeploymentWizard,
  type WizardStepId,
} from '../api/companiesApi';
import { MasterTenantsService } from '../services/masterTenantsService';
import type { MasterCompanyRow } from '../types/company';
import { touchRecentClient, touchRecentImplant } from '../ux/masterUxStorage';
import { MasterStatusBadge } from '../components/MasterStatusBadge';
import { MasterVisualTimeline } from '../components/MasterVisualTimeline';
import { MasterIntelligentOnboarding } from '../components/MasterIntelligentOnboarding';

const PLANS = [
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'ANNUAL', label: 'Anual' },
] as const;

/** Normaliza planos legados (FREE/TRIAL/STARTER/PRO/…) para o ciclo Mensal/Anual. */
function normalizePlan(value: string | null | undefined): string {
  return String(value || '').toUpperCase() === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';
}

const INPUT =
  'rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white w-full';

/**
 * /master/tenants/:companyId/implantacao — Wizard de Implantação (FASE 28).
 * Retomável; execução do Update Agent permanece fora do navegador.
 */
export function MasterImplantationWizardPage() {
  const { companyId = '' } = useParams<{ companyId: string }>();
  const [company, setCompany] = useState<MasterCompanyRow | null>(null);
  const [wizard, setWizard] = useState<DeploymentWizard | null>(null);
  const [journey, setJourney] = useState<CommercialJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentToken, setAgentToken] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [document, setDocument] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [plan, setPlan] = useState('MONTHLY');
  const [mode, setMode] = useState('LOCAL');
  const [skipAgent, setSkipAgent] = useState(false);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [row, wiz, jour] = await Promise.all([
        MasterTenantsService.get(companyId),
        fetchDeploymentWizard(companyId),
        fetchCommercialJourney(companyId),
      ]);
      setCompany(row);
      setWizard(wiz);
      setJourney({ ...jour, wizard: wiz });
      touchRecentClient(row.id, row.empresa);
      if (wiz.implantationStatus === 'Implantação concluída') {
        touchRecentImplant(row.id, row.empresa);
      }
      setCompanyName(row.empresa === 'Sem nome' ? '' : row.empresa);
      setDocument(row.document || '');
      setAdminName(row.administrador === '—' ? '' : row.administrador);
      setAdminEmail(row.administradorEmail || '');
      setPlan(normalizePlan(row.plano));
      setMode(row.modo || 'LOCAL');
      setSkipAgent(row.modo === 'SAAS');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar o assistente');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [companyId]);

  const currentStep = useMemo(() => {
    if (!wizard) return null;
    return (
      wizard.wizardSteps.find((s) => s.status === 'current') ??
      wizard.wizardSteps[wizard.currentStepIndex] ??
      null
    );
  }, [wizard]);

  async function runStep(step: WizardStepId) {
    setBusy(true);
    setError(null);
    try {
      const result = await runDeploymentWizardStep(companyId, step, {
        companyName: companyName.trim() || undefined,
        document: document.trim() || undefined,
        adminName: adminName.trim() || undefined,
        adminEmail: adminEmail.trim() || undefined,
        adminPassword: adminPassword.trim() || undefined,
        plan,
        mode,
        skipAgent: mode === 'SAAS' || skipAgent,
      });
      setWizard(result.wizard);
      setJourney({ ...result.journey, wizard: result.wizard });
      if (result.agentToken) setAgentToken(result.agentToken);
      const row = await MasterTenantsService.get(companyId);
      setCompany(row);
      if (result.wizard.implantationStatus === 'Implantação concluída') {
        touchRecentImplant(row.id, row.empresa);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na etapa');
      try {
        setWizard(await fetchDeploymentWizard(companyId));
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!agentToken) return;
    try {
      await navigator.clipboard.writeText(agentToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao copiar token');
    }
  }

  const done = wizard?.implantationStatus === 'Implantação concluída';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to={`/master/tenants/${companyId}`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar ao cliente
        </Link>
      </div>

      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500 dark:text-indigo-300">
          Assistente de Implantação
        </p>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">
          {company?.empresa || 'Nova implantação'}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Passo a passo retomável. O Agente de atualização recebe o token aqui; a instalação nunca roda no
          navegador.
        </p>
      </header>

      {!loading && journey && (
        <MasterIntelligentOnboarding
          companyId={companyId}
          journey={journey}
          company={company}
          showWizardLink={false}
          compact
        />
      )}

      {wizard && (
        <section className="space-y-3 rounded-2xl border border-border bg-surface shadow-card p-5 ">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Progresso</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
                <span>{wizard.progressPercent}%</span>
                <MasterStatusBadge status={wizard.implantationStatus} />
              </p>
            </div>
            {wizard.canResume && !done && (
              <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">
                Implantação interrompida — continue da etapa atual
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all duration-500"
              style={{ width: `${wizard.progressPercent}%` }}
            />
          </div>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {wizard.wizardSteps.map((step) => (
              <li
                key={step.id}
                className={`rounded-xl border px-3 py-2 text-xs ${
                  step.status === 'completed' || step.status === 'skipped'
                    ? 'border-emerald-500/25 bg-emerald-500/5'
                    : step.status === 'current'
                      ? 'border-indigo-500/40 bg-indigo-500/10'
                      : step.status === 'failed'
                        ? 'border-rose-500/30 bg-rose-500/5'
                        : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                  {step.status === 'completed' || step.status === 'skipped' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  {step.index + 1}. {step.label}
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{step.detail}</p>
              </li>
            ))}
          </ol>
          <MasterVisualTimeline
            className="mt-2 md:hidden"
            items={wizard.wizardSteps.map((step) => ({
              id: step.id,
              title: `${step.index + 1}. ${step.label}`,
              detail: step.detail,
              ok: step.status !== 'failed',
              meta: step.status,
            }))}
          />
        </section>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Token do Update Agent é exibido uma única vez. Configure-o no agente Windows — o Master
          apenas registra e aprova atualizações.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">
          {error}
        </p>
      )}

      {loading && <p className="text-sm text-slate-500">Carregando assistente…</p>}

      {!loading && wizard && !done && currentStep && (
        <section className="space-y-4 rounded-2xl border border-border bg-surface shadow-card p-5 ">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Etapa {currentStep.index + 1}: {currentStep.label}
          </h3>

          {(currentStep.id === 'register_company' || currentStep.id === 'create_admin') && (
            <div className="grid gap-3 sm:grid-cols-2">
              {currentStep.id === 'register_company' && (
                <>
                  <label className="text-xs text-slate-600 dark:text-slate-400">
                    Nome da empresa
                    <input
                      className={`${INPUT} mt-1`}
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                  </label>
                  <label className="text-xs text-slate-600 dark:text-slate-400">
                    CNPJ
                    <input
                      className={`${INPUT} mt-1`}
                      value={document}
                      onChange={(e) => setDocument(e.target.value)}
                    />
                  </label>
                </>
              )}
              {currentStep.id === 'create_admin' && (
                <>
                  <label className="text-xs text-slate-600 dark:text-slate-400">
                    Nome do administrador
                    <input
                      className={`${INPUT} mt-1`}
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                    />
                  </label>
                  <label className="text-xs text-slate-600 dark:text-slate-400">
                    E-mail do administrador
                    <input
                      type="email"
                      className={`${INPUT} mt-1`}
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                    />
                  </label>
                  <label className="text-xs text-slate-600 dark:text-slate-400 sm:col-span-2">
                    Senha provisória (opcional)
                    <input
                      type="password"
                      autoComplete="new-password"
                      className={`${INPUT} mt-1`}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Deixe em branco para enviar e-mail de primeiro acesso"
                    />
                    <span className="mt-1 block text-[10px] text-slate-500">
                      Se preenchida, o administrador já entra com esta senha (sem e-mail de
                      primeiro acesso). Deixe em branco para manter o convite por e-mail.
                    </span>
                  </label>
                </>
              )}
            </div>
          )}

          {currentStep.id === 'choose_plan' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-600 dark:text-slate-400">
                Plano
                <select
                  className={`${INPUT} mt-1`}
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                >
                  {PLANS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 dark:text-slate-400">
                Modo
                <select
                  className={`${INPUT} mt-1`}
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value);
                    setSkipAgent(e.target.value === 'SAAS');
                  }}
                >
                  <option value="SAAS">SaaS</option>
                  <option value="LOCAL">Local</option>
                  <option value="HYBRID">Híbrido</option>
                </select>
              </label>
            </div>
          )}

          {currentStep.id === 'generate_license' && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Será gerada uma licença {plan === 'ANNUAL' ? 'anual' : 'mensal'} e projetada no SaaS
              (somente leitura na empresa).
            </p>
          )}

          {currentStep.id === 'send_first_access' && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Enviar convite de primeiro acesso para{' '}
              <strong>{adminEmail || 'o administrador cadastrado'}</strong>.
            </p>
          )}

          {currentStep.id === 'issue_agent_token' && (
            <div className="space-y-3">
              {mode === 'SAAS' ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Modo SaaS: Update Agent é opcional. Você pode dispensar esta etapa.
                </p>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Gera instalação + token `uag_*` para o Agente de atualização (Local/Híbrido).
                </p>
              )}
              {mode !== 'SAAS' && (
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={skipAgent}
                    onChange={(e) => setSkipAgent(e.target.checked)}
                  />
                  Dispensar Update Agent nesta implantação
                </label>
              )}
            </div>
          )}

          {currentStep.id === 'finalize' && (
            <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              <li>Empresa criada: {wizard.summary.companyCreated ? 'sim' : 'não'}</li>
              <li>Licença ativa: {wizard.summary.licenseActive ? 'sim' : 'não'}</li>
              <li>Administrador criado: {wizard.summary.adminCreated ? 'sim' : 'não'}</li>
              <li>Primeiro acesso enviado: {wizard.summary.firstAccessSent ? 'sim' : 'não'}</li>
              <li>Atualizador registrado: {wizard.summary.updaterRegistered ? 'sim' : 'não'}</li>
            </ul>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void runStep(currentStep.id)}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Rocket className="h-4 w-4" />
            {busy
              ? 'Processando…'
              : currentStep.id === 'finalize'
                ? 'Finalizar implantação'
                : 'Continuar'}
          </button>
        </section>
      )}

      {agentToken && (
        <section className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900 dark:text-indigo-200">
            <KeyRound className="h-4 w-4" />
            Token do Update Agent (exibido uma vez)
          </div>
          <code className="block break-all rounded-lg bg-slate-950/90 px-3 py-2 font-mono text-xs text-emerald-300">
            {agentToken}
          </code>
          <button type="button" onClick={() => void copyToken()} className="inline-flex items-center gap-1 text-xs text-indigo-700 dark:text-indigo-300">
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </button>
        </section>
      )}

      {done && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-2">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Implantação concluída
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Empresa, licença, administrador, primeiro acesso e updater foram processados.
          </p>
          <Link
            to={`/master/tenants/${companyId}`}
            className="inline-flex text-sm text-indigo-600 hover:underline"
          >
            Ir para o cliente
          </Link>
        </section>
      )}
    </div>
  );
}

export default MasterImplantationWizardPage;
