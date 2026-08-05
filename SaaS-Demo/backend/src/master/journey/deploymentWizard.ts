/**
 * Wizard de Implantação — composição e validações (FASE 28).
 * Fonte de verdade: jornada comercial + Update Control Plane.
 */

export const WIZARD_STEP_IDS = [
  'register_company',
  'create_admin',
  'choose_plan',
  'generate_license',
  'send_first_access',
  'issue_agent_token',
  'finalize',
] as const;

export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];

export type WizardStepStatus = 'completed' | 'current' | 'pending' | 'failed' | 'skipped';

export type WizardStepView = {
  id: WizardStepId;
  index: number;
  label: string;
  status: WizardStepStatus;
  detail: string;
};

export type WizardMeta = {
  installationId?: string | null;
  agentTokenId?: string | null;
  agentTokenIssuedAt?: string | null;
  agentSkipped?: boolean;
  lastWizardStep?: WizardStepId | null;
  /** Estado da Automação Comercial (FASE 30) — persistido em wizard_meta.automation */
  automation?: Record<string, unknown> | null;
  /**
   * Senha provisória cifrada (AES-GCM) para reenvio idempotente do convite.
   * Sem migration — vive em wizard_meta JSONB.
   */
  inviteTemporaryPasswordEnc?: string | null;
};

export type WizardEvidence = {
  hasTenant: boolean;
  hasCompanyName: boolean;
  hasOperationalCompany: boolean;
  hasAdminName: boolean;
  hasAdminEmail: boolean;
  hasAdminUser: boolean;
  hasPlan: boolean;
  hasSubscription: boolean;
  hasLicense: boolean;
  licenseActive: boolean;
  inviteSent: boolean;
  agentRegistered: boolean;
  agentSkipped: boolean;
  implantationCompleted: boolean;
  failed: boolean;
  mode: string;
};

export const WIZARD_LABELS: Record<WizardStepId, string> = {
  register_company: 'Cadastrar empresa',
  create_admin: 'Criar administrador',
  choose_plan: 'Escolher plano',
  generate_license: 'Gerar licença',
  send_first_access: 'Enviar primeiro acesso',
  issue_agent_token: 'Gerar Token do Update Agent',
  finalize: 'Finalizar implantação',
};

export function parseWizardMeta(raw: unknown): WizardMeta {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  return {
    installationId: typeof row.installationId === 'string' ? row.installationId : null,
    agentTokenId: typeof row.agentTokenId === 'string' ? row.agentTokenId : null,
    agentTokenIssuedAt:
      typeof row.agentTokenIssuedAt === 'string' ? row.agentTokenIssuedAt : null,
    agentSkipped: row.agentSkipped === true,
    lastWizardStep:
      typeof row.lastWizardStep === 'string' &&
      (WIZARD_STEP_IDS as readonly string[]).includes(row.lastWizardStep)
        ? (row.lastWizardStep as WizardStepId)
        : null,
    automation:
      row.automation && typeof row.automation === 'object' && !Array.isArray(row.automation)
        ? (row.automation as Record<string, unknown>)
        : null,
    inviteTemporaryPasswordEnc:
      typeof row.inviteTemporaryPasswordEnc === 'string' ? row.inviteTemporaryPasswordEnc : null,
  };
}

/** Mescla patch no wizard_meta bruto sem apagar automation/outros campos. */
export function mergeWizardMetaRaw(
  currentRaw: unknown,
  patch: WizardMeta,
): Record<string, unknown> {
  const base =
    currentRaw && typeof currentRaw === 'object' && !Array.isArray(currentRaw)
      ? { ...(currentRaw as Record<string, unknown>) }
      : {};
  const next = { ...base, ...patch };
  if (!('automation' in patch) && 'automation' in base) {
    next.automation = base.automation as Record<string, unknown>;
  }
  if (!('inviteTemporaryPasswordEnc' in patch) && 'inviteTemporaryPasswordEnc' in base) {
    next.inviteTemporaryPasswordEnc =
      typeof base.inviteTemporaryPasswordEnc === 'string' ||
      base.inviteTemporaryPasswordEnc == null
        ? base.inviteTemporaryPasswordEnc
        : null;
  }
  return next;
}

export function isWizardStepDone(id: WizardStepId, evidence: WizardEvidence): boolean {
  switch (id) {
    case 'register_company':
      return evidence.hasTenant && evidence.hasCompanyName && evidence.hasOperationalCompany;
    case 'create_admin':
      return evidence.hasAdminName && evidence.hasAdminEmail && evidence.hasAdminUser;
    case 'choose_plan':
      return evidence.hasPlan && evidence.hasSubscription;
    case 'generate_license':
      return evidence.hasLicense && evidence.licenseActive;
    case 'send_first_access':
      return evidence.inviteSent;
    case 'issue_agent_token':
      return evidence.agentRegistered || evidence.agentSkipped;
    case 'finalize':
      return evidence.implantationCompleted;
    default:
      return false;
  }
}

export function validateWizardStep(
  id: WizardStepId,
  evidence: WizardEvidence,
): { ok: true } | { ok: false; code: string; message: string } {
  switch (id) {
    case 'register_company':
      if (!evidence.hasTenant || !evidence.hasCompanyName) {
        return {
          ok: false,
          code: 'COMPANY_REQUIRED',
          message: 'Informe o nome da empresa antes de continuar.',
        };
      }
      return { ok: true };
    case 'create_admin':
      if (!isWizardStepDone('register_company', evidence)) {
        return {
          ok: false,
          code: 'COMPANY_FIRST',
          message: 'Cadastre a empresa antes do administrador.',
        };
      }
      if (!evidence.hasAdminEmail || !evidence.hasAdminName) {
        return {
          ok: false,
          code: 'ADMIN_REQUIRED',
          message: 'Informe nome e e-mail do administrador.',
        };
      }
      return { ok: true };
    case 'choose_plan':
      if (!isWizardStepDone('create_admin', evidence)) {
        return {
          ok: false,
          code: 'ADMIN_FIRST',
          message: 'Crie o administrador antes de escolher o plano.',
        };
      }
      if (!evidence.hasPlan) {
        return { ok: false, code: 'PLAN_REQUIRED', message: 'Selecione um plano.' };
      }
      return { ok: true };
    case 'generate_license':
      if (!isWizardStepDone('choose_plan', evidence)) {
        return {
          ok: false,
          code: 'PLAN_FIRST',
          message: 'Escolha o plano antes de gerar a licença.',
        };
      }
      return { ok: true };
    case 'send_first_access':
      if (!isWizardStepDone('generate_license', evidence)) {
        return {
          ok: false,
          code: 'LICENSE_FIRST',
          message: 'Gere a licença antes de enviar o primeiro acesso.',
        };
      }
      if (!evidence.hasAdminUser && !evidence.hasAdminEmail) {
        return {
          ok: false,
          code: 'ADMIN_FIRST',
          message: 'Crie o administrador antes de enviar o primeiro acesso.',
        };
      }
      return { ok: true };
    case 'issue_agent_token':
      if (!isWizardStepDone('send_first_access', evidence)) {
        return {
          ok: false,
          code: 'FIRST_ACCESS_FIRST',
          message: 'Envie o primeiro acesso antes do token do Update Agent.',
        };
      }
      if (!evidence.hasOperationalCompany) {
        return {
          ok: false,
          code: 'COMPANY_FIRST',
          message: 'Empresa operacional necessária para registrar o Update Agent.',
        };
      }
      return { ok: true };
    case 'finalize': {
      const required: WizardStepId[] = [
        'register_company',
        'create_admin',
        'choose_plan',
        'generate_license',
        'send_first_access',
        'issue_agent_token',
      ];
      for (const step of required) {
        if (!isWizardStepDone(step, evidence)) {
          return {
            ok: false,
            code: 'STEPS_INCOMPLETE',
            message: `Conclua a etapa "${WIZARD_LABELS[step]}" antes de finalizar.`,
          };
        }
      }
      return { ok: true };
    }
    default:
      return { ok: false, code: 'UNKNOWN_STEP', message: 'Etapa inválida.' };
  }
}

export function composeWizardSteps(evidence: WizardEvidence): {
  steps: WizardStepView[];
  currentStepIndex: number;
  progressPercent: number;
  implantationStatus: 'not_started' | 'in_progress' | 'Implantação concluída' | 'failed';
  canResume: boolean;
} {
  let firstPending = -1;
  const steps: WizardStepView[] = WIZARD_STEP_IDS.map((id, index) => {
    const done = isWizardStepDone(id, evidence);
    let status: WizardStepStatus = done ? 'completed' : 'pending';
    if (!done && firstPending < 0) firstPending = index;
    if (id === 'issue_agent_token' && evidence.agentSkipped && done) {
      status = 'skipped';
    }
    if (evidence.failed && !done && firstPending === index) status = 'failed';
    return {
      id,
      index,
      label: WIZARD_LABELS[id],
      status,
      detail: detailFor(id, evidence, done),
    };
  });

  if (firstPending >= 0 && !evidence.failed) {
    steps[firstPending] = { ...steps[firstPending], status: 'current' };
  }

  const completedCount = steps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  ).length;
  const progressPercent = Math.round((completedCount / WIZARD_STEP_IDS.length) * 100);

  let implantationStatus: 'not_started' | 'in_progress' | 'Implantação concluída' | 'failed' =
    'not_started';
  if (evidence.failed) implantationStatus = 'failed';
  else if (evidence.implantationCompleted) implantationStatus = 'Implantação concluída';
  else if (completedCount > 0) implantationStatus = 'in_progress';

  return {
    steps,
    currentStepIndex: firstPending < 0 ? WIZARD_STEP_IDS.length - 1 : firstPending,
    progressPercent,
    implantationStatus,
    canResume: implantationStatus === 'in_progress' || implantationStatus === 'failed',
  };
}

function detailFor(id: WizardStepId, evidence: WizardEvidence, done: boolean): string {
  switch (id) {
    case 'register_company':
      return done ? 'Empresa operacional criada' : 'Pendência: cadastro da empresa';
    case 'create_admin':
      return done ? 'Administrador provisionado' : 'Pendência: administrador';
    case 'choose_plan':
      return done ? 'Plano e assinatura definidos' : 'Pendência: plano';
    case 'generate_license':
      return done ? 'Licença ativa' : 'Pendência: licença';
    case 'send_first_access':
      return done ? 'Primeiro acesso enviado' : 'Pendência: envio do convite';
    case 'issue_agent_token':
      if (evidence.agentSkipped) return 'Update Agent dispensado (SaaS)';
      return done ? 'Updater registrado' : 'Pendência: token do Update Agent';
    case 'finalize':
      return done ? 'Implantação concluída' : 'Pendência: finalizar';
    default:
      return '';
  }
}
