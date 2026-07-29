/**
 * Automação Comercial (FASE 30).
 * Pagamento = confirmação MANUAL no Master (sem gateway).
 * Após confirmar, o restante do pipeline roda automaticamente.
 */
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import {
  CommercialJourneyError,
  CommercialJourneyService,
} from './CommercialJourneyService.js';
import { isInviteDeliveryErrorCode } from './firstAccessInvite.service.js';
import { WIZARD_LABELS, type WizardStepId } from './deploymentWizard.js';
import { MasterNotifications } from './masterNotifications.js';

export type AutomationTimelineStepId =
  | 'client_registered'
  | 'plan_selected'
  | 'payment_confirmed'
  | 'license_created'
  | 'company_created'
  | 'admin_created'
  | 'first_access_sent'
  | 'company_released'
  | 'updater_prepared'
  | 'system_ready';

export type AutomationTimelineEvent = {
  at: string;
  step: AutomationTimelineStepId | WizardStepId | string;
  label: string;
  ok: boolean;
  detail: string;
  automatic: boolean;
};

export type AutomationStatus = 'idle' | 'running' | 'completed' | 'failed';

export type CommercialAutomationState = {
  status: AutomationStatus;
  paymentConfirmedAt: string | null;
  paymentRef: { type: string; id: string } | null;
  timeline: AutomationTimelineEvent[];
  lastError: string | null;
  completedAt: string | null;
  startedAt: string | null;
};

export type CommercialAutomationSnapshot = {
  tenantId: string;
  state: CommercialAutomationState;
  gatewayIntegrated: false;
  note: string;
};

const AUTO_WIZARD_ORDER: WizardStepId[] = [
  'register_company',
  'create_admin',
  'choose_plan',
  'generate_license',
  'send_first_access',
  'issue_agent_token',
  'finalize',
];

const WIZARD_TO_TIMELINE: Partial<Record<WizardStepId, AutomationTimelineStepId>> = {
  register_company: 'company_created',
  create_admin: 'admin_created',
  choose_plan: 'plan_selected',
  generate_license: 'license_created',
  send_first_access: 'first_access_sent',
  issue_agent_token: 'updater_prepared',
  finalize: 'system_ready',
};

function isInviteDeliveryFailure(error: unknown): boolean {
  if (error instanceof CommercialJourneyError) {
    return isInviteDeliveryErrorCode(error.code);
  }
  return false;
}

function inviteFailureLabel(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('sandbox')) return 'Convite — não enviado (Sandbox)';
  if (lower.includes('domínio') || lower.includes('dominio')) {
    return 'Convite — não enviado (domínio)';
  }
  return 'Convite — não enviado';
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyState(): CommercialAutomationState {
  return {
    status: 'idle',
    paymentConfirmedAt: null,
    paymentRef: null,
    timeline: [],
    lastError: null,
    completedAt: null,
    startedAt: null,
  };
}

function parseAutomation(raw: Record<string, unknown> | null | undefined): CommercialAutomationState {
  if (!raw || typeof raw !== 'object') return emptyState();
  return {
    status: (raw.status as AutomationStatus) || 'idle',
    paymentConfirmedAt: typeof raw.paymentConfirmedAt === 'string' ? raw.paymentConfirmedAt : null,
    paymentRef:
      raw.paymentRef && typeof raw.paymentRef === 'object'
        ? {
            type: String((raw.paymentRef as { type?: string }).type || 'manual'),
            id: String((raw.paymentRef as { id?: string }).id || ''),
          }
        : null,
    timeline: Array.isArray(raw.timeline)
      ? (raw.timeline as AutomationTimelineEvent[]).filter(
          (e) => e && typeof e.at === 'string' && typeof e.step === 'string',
        )
      : [],
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
  };
}

async function persistAutomation(
  tenantId: string,
  automation: CommercialAutomationState,
): Promise<void> {
  await CommercialJourneyService.patchWizardMeta(tenantId, {
    automation: automation as unknown as Record<string, unknown>,
  });
}

function appendEvent(
  state: CommercialAutomationState,
  event: Omit<AutomationTimelineEvent, 'at'> & { at?: string },
): CommercialAutomationState {
  return {
    ...state,
    timeline: [
      ...state.timeline,
      {
        at: event.at || nowIso(),
        step: event.step,
        label: event.label,
        ok: event.ok,
        detail: event.detail,
        automatic: event.automatic,
      },
    ],
  };
}

function notify(input: {
  tenantId: string;
  title: string;
  message: string;
  level?: 'info' | 'success' | 'warn' | 'error';
}): void {
  MasterNotifications.append({
    tenantId: input.tenantId,
    title: input.title,
    message: input.message,
    level: input.level ?? 'info',
  });
  try {
    // Via registry (dual-write PG) — nunca AuditService direto.
    MasterPlatformService.getAudit().append({
      action: 'COMMERCIAL_AUTOMATION',
      resource: 'automation',
      message: `${input.tenantId}: ${input.title}`,
      companyId: input.tenantId,
      before: null,
      after: {
        title: input.title,
        level: input.level ?? 'info',
      },
      meta: { title: input.title, level: input.level ?? 'info', tenantId: input.tenantId },
    });
  } catch {
    // audit opcional
  }
}

async function buildPrePaymentTimeline(
  tenantId: string,
  state: CommercialAutomationState,
): Promise<CommercialAutomationState> {
  const journey = await CommercialJourneyService.get(tenantId);
  let next = state;
  if (journey.wizard.summary.companyCreated || journey.operationalCompanyId) {
    next = appendEvent(next, {
      step: 'client_registered',
      label: 'Cadastro do cliente',
      ok: true,
      detail: 'Cliente/empresa Master cadastrado',
      automatic: false,
    });
  }
  if (journey.wizard.plan) {
    next = appendEvent(next, {
      step: 'plan_selected',
      label: 'Plano escolhido',
      ok: true,
      detail: `Plano ${journey.wizard.plan}`,
      automatic: false,
    });
  }
  return next;
}

export const CommercialAutomationService = {
  async get(tenantId: string): Promise<CommercialAutomationSnapshot> {
    const wizard = await CommercialJourneyService.getWizard(tenantId);
    const journey = await CommercialJourneyService.get(tenantId);
    const state = await this.readState(tenantId);
    const userActive =
      Boolean(journey.firstLoginAt) || journey.firstAccessStatus === 'accepted';

    let timeline = state.timeline;
    if (userActive) {
      // Reconcilia timeline sticky de falha Sandbox quando o usuário já está ativo.
      timeline = timeline.map((ev) =>
        ev.step === 'first_access_sent' && ev.ok === false
          ? {
              ...ev,
              ok: true,
              label: 'Convite aceito — usuário ativo',
              detail: 'Administrador já autenticou; falha de e-mail não bloqueia o acesso',
            }
          : ev,
      );
      if (!timeline.some((ev) => ev.step === 'first_access_sent' && ev.ok !== false)) {
        timeline = [
          ...timeline,
          {
            at: journey.firstLoginAt || nowIso(),
            step: 'first_access_sent',
            label: 'Usuário ativo',
            ok: true,
            detail: 'Primeiro acesso concluído',
            automatic: false,
          },
        ];
      }
    }

    return {
      tenantId,
      state: {
        ...state,
        timeline:
          timeline.length > 0
            ? timeline
            : wizard.implantationStatus === 'Implantação concluída'
              ? [
                  {
                    at: wizard.implantationCompletedAt || nowIso(),
                    step: 'system_ready',
                    label: 'Sistema pronto para uso',
                    ok: true,
                    detail: 'Implantação já concluída',
                    automatic: true,
                  },
                ]
              : timeline,
      },
      gatewayIntegrated: false,
      note:
        'Automação comercial — pagamento confirmado manualmente no Master; sem gateway financeiro',
    };
  },

  async readState(tenantId: string): Promise<CommercialAutomationState> {
    const raw = await CommercialJourneyService.readAutomationState(tenantId);
    return parseAutomation(raw);
  },

  /**
   * Confirmação manual de pagamento (Master) + pipeline automático.
   * Nunca chama gateway.
   */
  async onPaymentConfirmed(input: {
    tenantId: string;
    paymentRef?: { type: string; id: string } | null;
    actor?: { userId?: string | null; email?: string | null };
    force?: boolean;
  }): Promise<CommercialAutomationSnapshot> {
    const tenantId = String(input.tenantId || '').trim();
    if (!tenantId) {
      throw Object.assign(new Error('tenantId is required'), { status: 400, code: 'TENANT_REQUIRED' });
    }

    let state = await this.readState(tenantId);
    if (state.status === 'completed' && !input.force) {
      return {
        tenantId,
        state,
        gatewayIntegrated: false,
        note: 'Automação já concluída — use force para reprocessar',
      };
    }
    if (state.status === 'running' && !input.force) {
      return {
        tenantId,
        state,
        gatewayIntegrated: false,
        note: 'Automação já em execução',
      };
    }

    const paymentAt = nowIso();
    state = {
      ...emptyState(),
      status: 'running',
      startedAt: paymentAt,
      paymentConfirmedAt: paymentAt,
      paymentRef: input.paymentRef ?? { type: 'manual', id: `manual:${tenantId}` },
      timeline: [],
    };
    state = await buildPrePaymentTimeline(tenantId, state);
    state = appendEvent(state, {
      step: 'payment_confirmed',
      label: 'Pagamento confirmado (manual)',
      ok: true,
      detail: `Confirmado pelo Master · ref ${state.paymentRef?.type}:${state.paymentRef?.id}`,
      automatic: false,
    });
    await persistAutomation(tenantId, state);
    notify({
      tenantId,
      title: 'Pagamento confirmado',
      message: 'Pipeline automático de ativação iniciado (sem gateway).',
      level: 'info',
    });

    try {
      MasterPlatformService.getDashboard().logs.append({
        module: 'system',
        action: 'COMMERCIAL_AUTOMATION_STARTED',
        message: `Automação iniciada para ${tenantId}`,
        meta: { tenantId, paymentRef: state.paymentRef },
      });
    } catch {
      // ignore
    }

    try {
      const tenant = await MasterPlatformService.getTenantsService().get(tenantId);
      const skipAgent = String(tenant.mode || 'SAAS').toUpperCase() === 'SAAS';

      for (const step of AUTO_WIZARD_ORDER) {
        const wizardBefore = await CommercialJourneyService.getWizard(tenantId);
        const stepView = wizardBefore.wizardSteps.find((s) => s.id === step);
        const already =
          stepView?.status === 'completed' || stepView?.status === 'skipped';

        if (already) {
          state = appendEvent(state, {
            step: WIZARD_TO_TIMELINE[step] || step,
            label: WIZARD_LABELS[step],
            ok: true,
            detail: 'Já concluído — ignorado no pipeline automático',
            automatic: true,
          });
          await persistAutomation(tenantId, state);
          continue;
        }

        // Convite é etapa independente: falha de e-mail NÃO invalida o provisionamento.
        if (step === 'send_first_access') {
          try {
            await CommercialJourneyService.runWizardStep(
              tenantId,
              step,
              {
                skipAgent: undefined,
              },
              input.actor,
            );
            state = appendEvent(state, {
              step: 'first_access_sent',
              label: 'Convite enviado',
              ok: true,
              detail: 'Convite de primeiro acesso enviado',
              automatic: true,
            });
            await persistAutomation(tenantId, state);
            notify({
              tenantId,
              title: 'Convite enviado',
              message: 'Convite de primeiro acesso enviado com sucesso.',
              level: 'success',
            });
          } catch (inviteError) {
            if (!isInviteDeliveryFailure(inviteError)) throw inviteError;
            const friendly =
              inviteError instanceof Error ? inviteError.message : String(inviteError);
            state = appendEvent(state, {
              step: 'first_access_sent',
              label: inviteFailureLabel(friendly),
              ok: false,
              detail: friendly,
              automatic: true,
            });
            await persistAutomation(tenantId, state);
            notify({
              tenantId,
              title: 'Convite pendente',
              message: friendly,
              level: 'warn',
            });
            // Não avança agent/finalize: validações existentes exigem convite concluído.
            // Provisionamento (empresa/admin/licença) permanece válido.
            break;
          }
          continue;
        }

        await CommercialJourneyService.runWizardStep(
          tenantId,
          step,
          {
            skipAgent: step === 'issue_agent_token' ? skipAgent : undefined,
          },
          input.actor,
        );

        if (step === 'generate_license') {
          state = appendEvent(state, {
            step: 'license_created',
            label: 'Licença criada',
            ok: true,
            detail: 'Licença ativa + projeção comercial',
            automatic: true,
          });
          state = appendEvent(state, {
            step: 'company_released',
            label: 'Empresa liberada',
            ok: true,
            detail: 'Tenant ativado e bloqueio comercial liberado',
            automatic: true,
          });
        } else {
          state = appendEvent(state, {
            step: WIZARD_TO_TIMELINE[step] || step,
            label: WIZARD_LABELS[step],
            ok: true,
            detail: 'Executado automaticamente após pagamento',
            automatic: true,
          });
        }
        await persistAutomation(tenantId, state);
        notify({
          tenantId,
          title: WIZARD_LABELS[step],
          message: `Etapa automática concluída: ${WIZARD_LABELS[step]}`,
          level: 'success',
        });
      }

      state = {
        ...state,
        status: 'completed',
        completedAt: nowIso(),
        lastError: null,
      };
      const invitePending = state.timeline.some(
        (ev) =>
          ev.step === 'first_access_sent' &&
          ev.ok === false &&
          String(ev.label || '').toLowerCase().includes('convite'),
      );
      state = appendEvent(state, {
        step: 'system_ready',
        label: invitePending ? 'Provisionamento concluído' : 'Sistema pronto para uso',
        ok: true,
        detail: invitePending
          ? 'Provisionamento concluído. Convite pendente — use Reenviar convite.'
          : 'Pipeline comercial automático finalizado',
        automatic: true,
      });
      await persistAutomation(tenantId, state);
      notify({
        tenantId,
        title: invitePending ? 'Provisionamento concluído' : 'Sistema pronto para uso',
        message: invitePending
          ? 'Empresa provisionada. Convite de e-mail pendente — utilize Reenviar convite.'
          : 'Ativação comercial concluída automaticamente após pagamento manual.',
        level: invitePending ? 'warn' : 'success',
      });

      try {
        MasterPlatformService.getDashboard().logs.append({
          module: 'system',
          action: 'COMMERCIAL_AUTOMATION_COMPLETED',
          message: `Automação concluída para ${tenantId}`,
          meta: { tenantId, paymentRef: state.paymentRef },
        });
      } catch {
        // ignore
      }

      return {
        tenantId,
        state,
        gatewayIntegrated: false,
        note: 'Automação concluída — pagamento foi manual; sem gateway',
      };
    } catch (error) {
      // Segurança: falha só de convite nunca deve marcar provisionamento como "Falha na automação".
      if (isInviteDeliveryFailure(error)) {
        const friendly = error instanceof Error ? error.message : String(error);
        state = appendEvent(state, {
          step: 'first_access_sent',
          label: inviteFailureLabel(friendly),
          ok: false,
          detail: friendly,
          automatic: true,
        });
        state = {
          ...state,
          status: 'completed',
          completedAt: nowIso(),
          lastError: null,
        };
        state = appendEvent(state, {
          step: 'system_ready',
          label: 'Provisionamento concluído',
          ok: true,
          detail: 'Provisionamento concluído. Convite pendente — use Reenviar convite.',
          automatic: true,
        });
        await persistAutomation(tenantId, state).catch(() => undefined);
        notify({
          tenantId,
          title: 'Provisionamento concluído',
          message: friendly,
          level: 'warn',
        });
        return {
          tenantId,
          state,
          gatewayIntegrated: false,
          note: 'Provisionamento concluído — convite pendente',
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      state = {
        ...state,
        status: 'failed',
        lastError: message,
      };
      state = appendEvent(state, {
        step: 'system_ready',
        label: 'Falha na automação',
        ok: false,
        detail: message,
        automatic: true,
      });
      await persistAutomation(tenantId, state).catch(() => undefined);
      notify({
        tenantId,
        title: 'Falha na automação comercial',
        message,
        level: 'error',
      });
      throw error;
    }
  },

  /** Retoma automação após falha (pagamento já confirmado). */
  async retry(
    tenantId: string,
    actor?: { userId?: string | null; email?: string | null },
  ): Promise<CommercialAutomationSnapshot> {
    const state = await this.readState(tenantId);
    return this.onPaymentConfirmed({
      tenantId,
      paymentRef: state.paymentRef,
      actor,
      force: true,
    });
  },

  /** Dispara automação a partir de fatura/pagamento marcado como pago (se houver tenantId). */
  async tryFromPaymentRef(input: {
    tenantId?: string | null;
    paymentRef: { type: string; id: string };
    actor?: { userId?: string | null; email?: string | null };
  }): Promise<CommercialAutomationSnapshot | null> {
    const tenantId = String(input.tenantId || '').trim();
    if (!tenantId) return null;
    try {
      return await this.onPaymentConfirmed({
        tenantId,
        paymentRef: input.paymentRef,
        actor: input.actor,
      });
    } catch (error) {
      // Pagamento permanece confirmado; automação pode ser retomada.
      try {
        MasterPlatformService.getDashboard().logs.append({
          module: 'system',
          action: 'COMMERCIAL_AUTOMATION_FAILED',
          message: error instanceof Error ? error.message : String(error),
          meta: { tenantId, paymentRef: input.paymentRef },
        });
      } catch {
        // ignore
      }
      return this.get(tenantId);
    }
  },
};
