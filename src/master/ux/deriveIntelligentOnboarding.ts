/**
 * FASE 33 — Onboarding Inteligente.
 * Deriva a jornada visual apenas a partir de journey / wizard / automation / CRM / row já existentes.
 * Não inventa regras de negócio nem chama APIs novas.
 */

import type {
  CommercialAutomation,
  CommercialJourney,
  DeploymentWizard,
} from '../api/companiesApi';
import type { CrmProfile } from '../api/crmApi';
import type { MasterCompanyRow } from '../types/company';
import type { MasterTimelineItem } from '../components/MasterVisualTimeline';

export type OnboardingMilestoneId =
  | 'company_created'
  | 'admin_created'
  | 'plan_defined'
  | 'license_active'
  | 'first_access_sent'
  | 'first_login'
  | 'operational';

export type OnboardingMilestoneStatus = 'completed' | 'current' | 'pending' | 'failed';

export type OnboardingMilestone = {
  id: OnboardingMilestoneId;
  label: string;
  status: OnboardingMilestoneStatus;
  detail: string;
  at: string | null;
  /** Quem executou — inferido de sinais já existentes (automação / e-mail admin / manual). */
  actor: string | null;
};

export type IntelligentOnboardingView = {
  milestones: OnboardingMilestone[];
  progressPercent: number;
  currentLabel: string | null;
  pending: OnboardingMilestone[];
  /** Tempo médio entre marcos com timestamp (ms → texto). */
  averageStepLabel: string | null;
  /** Tempo decorrido do início ao fim (ou até agora). */
  elapsedLabel: string | null;
  timeline: MasterTimelineItem[];
  automationTimeline: MasterTimelineItem[];
  implantationStatus: string;
};

function journeyStep(
  journey: CommercialJourney | null | undefined,
  id: CommercialJourney['steps'][number]['id'],
) {
  return journey?.steps?.find((s) => s.id === id) ?? null;
}

function wizardStep(wizard: DeploymentWizard | null | undefined, id: string) {
  return wizard?.wizardSteps?.find((s) => s.id === id) ?? null;
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} d`;
}

function formatAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(t),
  );
}

function statusFromBool(
  done: boolean,
  failed = false,
): Exclude<OnboardingMilestoneStatus, 'current'> {
  if (failed) return 'failed';
  return done ? 'completed' : 'pending';
}

function actorFromAutomation(
  automation: CommercialAutomation | null | undefined,
  stepHints: string[],
): string | null {
  const events = automation?.state.timeline ?? [];
  const hit = [...events].reverse().find((ev) =>
    stepHints.some(
      (h) =>
        ev.step.toLowerCase().includes(h) ||
        ev.label.toLowerCase().includes(h) ||
        ev.detail.toLowerCase().includes(h),
    ),
  );
  if (!hit) return null;
  if (hit.automatic) return 'Automação Master';
  return 'Operador Master (manual)';
}

export function deriveIntelligentOnboarding(input: {
  journey: CommercialJourney | null | undefined;
  automation?: CommercialAutomation | null;
  company?: MasterCompanyRow | null;
  crm?: Pick<CrmProfile, 'lastAccessAt' | 'deploymentDate' | 'contactName' | 'email'> | null;
}): IntelligentOnboardingView {
  const journey = input.journey ?? null;
  const wizard = journey?.wizard ?? null;
  const summary = wizard?.summary;
  const automation = input.automation ?? null;
  const company = input.company ?? null;
  const crm = input.crm ?? null;

  const companyCreated =
    Boolean(summary?.companyCreated) ||
    Boolean(journey?.operationalCompanyId) ||
    wizardStep(wizard, 'register_company')?.status === 'completed' ||
    journeyStep(journey, 'company')?.status === 'completed' ||
    Boolean(company?.id);

  const adminCreated =
    Boolean(summary?.adminCreated) ||
    Boolean(journey?.adminUserId) ||
    wizardStep(wizard, 'create_admin')?.status === 'completed';

  const planDefined =
    wizardStep(wizard, 'choose_plan')?.status === 'completed' ||
    journeyStep(journey, 'plan')?.status === 'completed' ||
    Boolean(journey?.subscriptionId) ||
    Boolean(wizard?.plan) ||
    Boolean(company?.plano && company.plano !== '—');

  const licenseActive =
    Boolean(summary?.licenseActive) ||
    wizardStep(wizard, 'generate_license')?.status === 'completed' ||
    journeyStep(journey, 'license')?.status === 'completed' ||
    Boolean(journey?.licenseId);

  const firstAccessSent =
    Boolean(summary?.firstAccessSent) ||
    Boolean(journey?.inviteSentAt) ||
    journey?.firstAccessStatus === 'accepted' ||
    Boolean(journey?.firstLoginAt) ||
    wizardStep(wizard, 'send_first_access')?.status === 'completed' ||
    journeyStep(journey, 'admin')?.status === 'completed';

  const firstLogin =
    Boolean(journey?.firstLoginAt) ||
    journeyStep(journey, 'first_login')?.status === 'completed' ||
    journey?.state === 'completed';

  // firstLoginDone: primeiro login do admin (domínio Master), não indicadores de ponto.
  const firstLoginDone = firstLogin;

  const milestonesRaw: OnboardingMilestone[] = [
    {
      id: 'company_created',
      label: 'Empresa criada',
      status: statusFromBool(companyCreated, false),
      detail:
        journeyStep(journey, 'company')?.detail ||
        wizardStep(wizard, 'register_company')?.detail ||
        (companyCreated ? 'Cadastro Master disponível.' : 'Aguardando criação da empresa.'),
      at: company?.data || null,
      actor:
        actorFromAutomation(automation, ['company', 'cadastro', 'register']) ||
        (companyCreated ? 'Master / assistente' : null),
    },
    {
      id: 'admin_created',
      label: 'Administrador criado',
      status: statusFromBool(adminCreated),
      detail:
        wizardStep(wizard, 'create_admin')?.detail ||
        (journey?.adminEmail
          ? `Admin: ${journey.adminEmail}`
          : adminCreated
            ? 'Administrador provisionado.'
            : 'Aguardando criação do administrador.'),
      at: null,
      actor:
        actorFromAutomation(automation, ['admin', 'create_admin']) ||
        journey?.adminEmail ||
        null,
    },
    {
      id: 'plan_defined',
      label: 'Plano definido',
      status: statusFromBool(planDefined),
      detail:
        journeyStep(journey, 'plan')?.detail ||
        wizardStep(wizard, 'choose_plan')?.detail ||
        (wizard?.plan || company?.plano
          ? `Plano: ${wizard?.plan || company?.plano}`
          : 'Aguardando definição do plano.'),
      at: null,
      actor: actorFromAutomation(automation, ['plan', 'plano', 'choose_plan']),
    },
    {
      id: 'license_active',
      label: 'Licença ativa',
      status: statusFromBool(licenseActive),
      detail:
        journeyStep(journey, 'license')?.detail ||
        wizardStep(wizard, 'generate_license')?.detail ||
        (licenseActive ? 'Licença vinculada / ativa.' : 'Aguardando licença ativa.'),
      at: null,
      actor: actorFromAutomation(automation, ['license', 'licença', 'generate_license']),
    },
    {
      id: 'first_access_sent',
      label: 'Primeiro acesso enviado',
      status: statusFromBool(firstAccessSent),
      detail:
        wizardStep(wizard, 'send_first_access')?.detail ||
        journeyStep(journey, 'admin')?.detail ||
        (journey?.inviteSentAt
          ? 'Convite / primeiro acesso registrado.'
          : 'Aguardando envio do primeiro acesso.'),
      at: journey?.inviteSentAt || null,
      actor:
        actorFromAutomation(automation, ['first_access', 'acesso', 'invite']) ||
        journey?.adminEmail ||
        null,
    },
    {
      id: 'first_login',
      label: 'Primeiro acesso realizado',
      status: statusFromBool(firstLoginDone),
      detail:
        journeyStep(journey, 'first_login')?.detail ||
        (journey?.firstLoginAt
          ? 'Primeiro login registrado na jornada comercial.'
          : crm?.lastAccessAt
            ? 'CRM indica último acesso (referência comercial).'
            : 'Aguardando primeiro login do administrador.'),
      at: journey?.firstLoginAt || crm?.lastAccessAt || null,
      actor: journey?.adminEmail || crm?.email || crm?.contactName || null,
    },
    {
      id: 'operational',
      label: 'Empresa operacional',
      status: statusFromBool(
        Boolean(summary?.implantationCompleted) ||
          wizard?.implantationStatus === 'Implantação concluída' ||
          Boolean(wizard?.implantationCompletedAt) ||
          journeyStep(journey, 'activation')?.status === 'completed' ||
          (firstLogin && licenseActive && companyCreated),
      ),
      detail:
        journeyStep(journey, 'activation')?.detail ||
        (Boolean(summary?.implantationCompleted) ||
        wizard?.implantationStatus === 'Implantação concluída'
          ? 'Implantação / ativação concluída nos dados comerciais.'
          : crm?.deploymentDate
            ? `CRM: data de implantação ${crm.deploymentDate}.`
            : 'Aguardando conclusão da implantação comercial.'),
      at: wizard?.implantationCompletedAt || crm?.deploymentDate || automation?.state.completedAt || null,
      actor:
        actorFromAutomation(automation, ['finalize', 'pronto', 'operational', 'ativação']) ||
        null,
    },
  ];

  // Marca etapa atual = primeiro pendente/failed
  let currentSet = false;
  const milestones = milestonesRaw.map((m) => {
    if (currentSet) return m;
    if (m.status === 'pending' || m.status === 'failed') {
      currentSet = true;
      return { ...m, status: m.status === 'failed' ? m.status : ('current' as const) };
    }
    return m;
  });

  const completedCount = milestones.filter((m) => m.status === 'completed').length;
  const progressFromWizard =
    typeof wizard?.progressPercent === 'number' ? wizard.progressPercent : null;
  const progressPercent =
    progressFromWizard != null && progressFromWizard > 0
      ? Math.max(
          progressFromWizard,
          Math.round((completedCount / milestones.length) * 100),
        )
      : Math.round((completedCount / milestones.length) * 100);

  const current = milestones.find((m) => m.status === 'current' || m.status === 'failed');
  const pending = milestones.filter(
    (m) => m.status === 'pending' || m.status === 'current' || m.status === 'failed',
  );

  const timed = milestones
    .map((m) => parseTime(m.at))
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);

  let averageStepLabel: string | null = null;
  if (timed.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < timed.length; i += 1) gaps.push(timed[i]! - timed[i - 1]!);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    averageStepLabel = formatDuration(avg);
  }

  const start =
    parseTime(company?.data) ||
    parseTime(automation?.state.startedAt) ||
    parseTime(automation?.state.paymentConfirmedAt) ||
    timed[0] ||
    null;
  const operationalDone =
    Boolean(summary?.implantationCompleted) ||
    wizard?.implantationStatus === 'Implantação concluída' ||
    Boolean(wizard?.implantationCompletedAt) ||
    journeyStep(journey, 'activation')?.status === 'completed' ||
    (firstLoginDone && licenseActive && companyCreated);

  const end =
    parseTime(wizard?.implantationCompletedAt) ||
    parseTime(automation?.state.completedAt) ||
    (operationalDone ? timed[timed.length - 1] : null) ||
    Date.now();
  const elapsedLabel = start != null ? formatDuration(end - start) : null;

  const timelineFromAutomation: MasterTimelineItem[] = (automation?.state.timeline ?? []).map(
    (ev, idx) => ({
      id: `auto-${ev.at}-${ev.step}-${idx}`,
      title: ev.label,
      detail: `${ev.detail}${ev.automatic ? '' : ' · Operador Master'}`,
      meta: ev.automatic ? 'automático' : 'manual',
      at: formatAt(ev.at) || ev.at,
      ok: ev.ok,
      automatic: ev.automatic,
    }),
  );

  const timelineFromMilestones: MasterTimelineItem[] = milestones.map((m) => ({
    id: `ms-${m.id}`,
    title: m.label,
    detail: [m.detail, m.actor ? `Quem: ${m.actor}` : null].filter(Boolean).join(' · '),
    meta:
      m.status === 'completed'
        ? 'concluído'
        : m.status === 'current'
          ? 'etapa atual'
          : m.status === 'failed'
            ? 'falha'
            : 'pendente',
    at: formatAt(m.at),
    ok: m.status === 'completed' ? true : m.status === 'failed' ? false : undefined,
  }));

  const timeline = timelineFromMilestones;
  const automationTimeline = timelineFromAutomation;

  return {
    milestones,
    progressPercent: Math.min(100, Math.max(0, progressPercent)),
    currentLabel: current?.label ?? (operationalDone ? 'Empresa operacional' : null),
    pending,
    averageStepLabel,
    elapsedLabel,
    timeline,
    automationTimeline,
    implantationStatus:
      wizard?.implantationStatus ||
      journey?.state ||
      (operationalDone ? 'Implantação concluída' : 'in_progress'),
  };
}
