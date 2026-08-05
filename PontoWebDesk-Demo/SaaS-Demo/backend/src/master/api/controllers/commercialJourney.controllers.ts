import type { Response } from 'express';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import {
  CommercialJourneyError,
  CommercialJourneyService,
} from '../../journey/CommercialJourneyService.js';
import { WIZARD_STEP_IDS, type WizardStepId } from '../../journey/deploymentWizard.js';
import { MasterApiServices } from '../services/index.js';

function sendError(res: Response, error: unknown): void {
  if (error instanceof CommercialJourneyError) {
    res.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message,
      message: error.message,
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Falha na jornada comercial.';
  res.status(500).json({ ok: false, code: 'COMMERCIAL_JOURNEY_FAILED', error: message, message });
}

function audit(
  req: MasterApiRequest,
  input: {
    action: string;
    message: string;
    companyId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    meta?: Record<string, unknown>;
  },
): void {
  MasterApiServices.recordAudit(req, {
    action: input.action,
    resource: 'commercial_journey',
    message: input.message,
    companyId: input.companyId,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta,
  });
}

export async function getCommercialJourney(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const journey = await CommercialJourneyService.get(String(req.params.id || '').trim());
    res.json({ ok: true, journey, wizard: journey.wizard });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getDeploymentWizard(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const wizard = await CommercialJourneyService.getWizard(String(req.params.id || '').trim());
    res.json({ ok: true, wizard });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postCommercialJourneyProvision(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const tenantId = String(req.params.id || '').trim();
    const before = await CommercialJourneyService.get(tenantId).catch(() => null);
    const idempotencyKey = String(req.header('Idempotency-Key') || `provision:${tenantId}`).trim();
    const journey = await CommercialJourneyService.provision(
      tenantId,
      idempotencyKey,
      {
        userId: req.masterAuth?.userId,
        email: req.masterAuth?.email,
      },
    );
    audit(req, {
      action: 'JOURNEY_PROVISION',
      message: `Provisionamento comercial: ${tenantId}`,
      companyId: tenantId,
      before: before
        ? { state: before.state, wizardStep: before.wizard?.currentStepId }
        : null,
      after: { state: journey.state, wizardStep: journey.wizard?.currentStepId },
      meta: { idempotencyKey },
    });
    res.json({ ok: true, journey, wizard: journey.wizard });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postCommercialJourneyResendFirstAccess(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const tenantId = String(req.params.id || '').trim();
    const journey = await CommercialJourneyService.resendFirstAccess(tenantId, {
      userId: req.masterAuth?.userId,
      email: req.masterAuth?.email,
    });
    audit(req, {
      action: 'JOURNEY_RESEND_FIRST_ACCESS',
      message: `Reenvio primeiro acesso: ${tenantId}`,
      companyId: tenantId,
      before: null,
      after: { state: journey.state, wizardStep: journey.wizard?.currentStepId },
    });
    res.json({ ok: true, journey, wizard: journey.wizard });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postCommercialJourneyPrepareFirstAccessPassword(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const tenantId = String(req.params.id || '').trim();
    const result = await CommercialJourneyService.prepareFirstAccessPassword(tenantId, {
      userId: req.masterAuth?.userId,
      email: req.masterAuth?.email,
    });
    audit(req, {
      action: 'JOURNEY_PREPARE_FIRST_ACCESS_PASSWORD',
      message: `Senha provisória gerada: ${tenantId}`,
      companyId: tenantId,
      before: null,
      after: {
        state: result.state,
        firstAccessStatus: result.firstAccessStatus ?? null,
        temporaryPasswordExpiresAt: result.temporaryPasswordExpiresAt ?? null,
      },
      meta: { expiresAt: result.expiresAt },
    });
    res.json({
      ok: true,
      journey: result,
      temporaryPassword: result.temporaryPassword,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postDeploymentWizardStep(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const tenantId = String(req.params.id || '').trim();
    const step = String(req.params.step || '').trim() as WizardStepId;
    if (!(WIZARD_STEP_IDS as readonly string[]).includes(step)) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_WIZARD_STEP',
        message: `step must be one of: ${WIZARD_STEP_IDS.join(', ')}`,
      });
      return;
    }
    const before = await CommercialJourneyService.get(tenantId).catch(() => null);
    const journey = await CommercialJourneyService.runWizardStep(
      tenantId,
      step,
      {
        companyName: req.body?.companyName,
        document: req.body?.document,
        adminName: req.body?.adminName,
        adminEmail: req.body?.adminEmail,
        adminPassword: req.body?.adminPassword,
        plan: req.body?.plan,
        mode: req.body?.mode,
        skipAgent: req.body?.skipAgent === true,
        channel: req.body?.channel,
      },
      {
        userId: req.masterAuth?.userId,
        email: req.masterAuth?.email,
      },
    );
    audit(req, {
      action: 'JOURNEY_WIZARD_STEP',
      message: `Wizard step ${step}: ${tenantId}`,
      companyId: tenantId,
      before: before
        ? { wizardStep: before.wizard?.currentStepId, state: before.state }
        : null,
      after: {
        wizardStep: journey.wizard?.currentStepId,
        state: journey.state,
        agentTokenIssued: Boolean(journey.wizard?.agentTokenOnce),
      },
      meta: { step },
    });
    res.json({
      ok: true,
      journey,
      wizard: journey.wizard,
      agentToken: journey.wizard.agentTokenOnce ?? null,
      agentTokenId: journey.wizard.agentTokenIdOnce ?? null,
      note: journey.wizard.agentTokenOnce
        ? 'Guarde o token do Update Agent — ele não será exibido novamente.'
        : undefined,
    });
  } catch (error) {
    sendError(res, error);
  }
}
