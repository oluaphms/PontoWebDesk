import type { Response } from 'express';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import {
  CommercialCrmError,
  CommercialCrmService,
} from '../../crm/CommercialCrmService.js';
import type {
  CrmAttendanceChannel,
  CrmPaymentMethod,
  CrmReminderStatus,
  CrmSituation,
} from '../../crm/crm.types.js';
import { MasterApiServices } from '../services/index.js';

function actor(req: MasterApiRequest) {
  return {
    userId: req.masterAuth?.userId ?? null,
    email: req.masterAuth?.email ?? null,
  };
}

function audit(
  req: MasterApiRequest,
  input: {
    action: string;
    message: string;
    companyId: string;
    companyName?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    meta?: Record<string, unknown>;
  },
): void {
  MasterApiServices.recordAudit(req, {
    action: input.action,
    resource: 'crm',
    message: input.message,
    companyId: input.companyId,
    companyName: input.companyName ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta,
  });
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof CommercialCrmError) {
    res.status(error.status).json({
      ok: false,
      error: error.code,
      code: error.code,
      message: error.message,
    });
    return;
  }
  const pgCode = (error as { code?: string }).code;
  if (pgCode === '42P01' || pgCode === '42703') {
    res.status(503).json({
      ok: false,
      error: 'MASTER_CRM_SCHEMA_REQUIRED',
      code: 'MASTER_CRM_SCHEMA_REQUIRED',
      message: 'Aplique a migration 024 do CRM Comercial Master.',
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'MASTER_CRM_FAILED',
    code: 'MASTER_CRM_FAILED',
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function getCrmDirectory(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const q = req.query;
    const rows = await CommercialCrmService.listProfiles({
      q: q.q ? String(q.q) : undefined,
      city: q.city ? String(q.city) : undefined,
      plan: q.plan ? String(q.plan) : undefined,
      situation: q.situation ? String(q.situation) : undefined,
      dueBefore: q.dueBefore ? String(q.dueBefore) : undefined,
      dueAfter: q.dueAfter ? String(q.dueAfter) : undefined,
      lastAccessBefore: q.lastAccessBefore ? String(q.lastAccessBefore) : undefined,
      lastAccessAfter: q.lastAccessAfter ? String(q.lastAccessAfter) : undefined,
      lastUpdateBefore: q.lastUpdateBefore ? String(q.lastUpdateBefore) : undefined,
      lastUpdateAfter: q.lastUpdateAfter ? String(q.lastUpdateAfter) : undefined,
    });
    res.json({ ok: true, rows, count: rows.length, persistence: 'postgres' });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getTenantCrm(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const snapshot = await CommercialCrmService.getSnapshot(String(req.params.id ?? ''));
    res.json({ ok: true, ...snapshot, persistence: 'postgres' });
  } catch (error) {
    sendError(res, error);
  }
}

export async function putTenantCrmProfile(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const tenantId = String(req.params.id ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    let before: Record<string, unknown> | null = null;
    try {
      const snap = await CommercialCrmService.getSnapshot(tenantId);
      before = (snap.profile as Record<string, unknown> | null) ?? null;
    } catch {
      before = null;
    }
    const profile = await CommercialCrmService.upsertProfile(
      tenantId,
      {
        companyName: body.companyName as string | undefined,
        contactName: body.contactName as string | undefined,
        phone: body.phone as string | null | undefined,
        whatsapp: body.whatsapp as string | null | undefined,
        email: body.email as string | null | undefined,
        city: body.city as string | null | undefined,
        state: body.state as string | null | undefined,
        contractedPlan: body.contractedPlan as string | null | undefined,
        negotiatedAmountCents:
          body.negotiatedAmountCents != null ? Number(body.negotiatedAmountCents) : undefined,
        paymentMethod: body.paymentMethod as CrmPaymentMethod | null | undefined,
        pixKey: body.pixKey as string | null | undefined,
        dueDate: body.dueDate as string | null | undefined,
        situation: body.situation as CrmSituation | undefined,
        notes: body.notes as string | null | undefined,
        lastContactAt: body.lastContactAt as string | null | undefined,
        deploymentDate: body.deploymentDate as string | null | undefined,
        lastAccessAt: body.lastAccessAt as string | null | undefined,
        lastUpdateAt: body.lastUpdateAt as string | null | undefined,
      },
      actor(req),
    );
    audit(req, {
      action: 'CRM_PROFILE_UPSERT',
      message: `CRM perfil atualizado: ${tenantId}`,
      companyId: tenantId,
      companyName: profile.companyName ?? null,
      before,
      after: profile as unknown as Record<string, unknown>,
    });
    res.json({ ok: true, profile });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postTenantCrmAttendance(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const tenantId = String(req.params.id ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const attendance = await CommercialCrmService.addAttendance(
      tenantId,
      {
        channel: body.channel as CrmAttendanceChannel | undefined,
        subject: String(body.subject ?? ''),
        body: body.body as string | null | undefined,
        outcome: body.outcome as string | null | undefined,
        attendedAt: body.attendedAt as string | null | undefined,
      },
      actor(req),
    );
    audit(req, {
      action: 'CRM_ATTENDANCE_CREATED',
      message: `CRM atendimento: ${tenantId}`,
      companyId: tenantId,
      before: null,
      after: attendance as unknown as Record<string, unknown>,
    });
    res.status(201).json({ ok: true, attendance });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postTenantCrmReminder(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const tenantId = String(req.params.id ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reminder = await CommercialCrmService.addReminder(
      tenantId,
      {
        title: String(body.title ?? ''),
        body: body.body as string | null | undefined,
        dueAt: String(body.dueAt ?? ''),
      },
      actor(req),
    );
    audit(req, {
      action: 'CRM_REMINDER_CREATED',
      message: `CRM lembrete: ${tenantId}`,
      companyId: tenantId,
      before: null,
      after: reminder as unknown as Record<string, unknown>,
    });
    res.status(201).json({ ok: true, reminder });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postTenantCrmReminderStatus(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const tenantId = String(req.params.id ?? '');
    const reminderId = String(req.params.reminderId ?? '');
    const status = String(req.params.status ?? '') as CrmReminderStatus;
    const reminder = await CommercialCrmService.setReminderStatus(
      tenantId,
      reminderId,
      status,
      actor(req),
    );
    audit(req, {
      action: 'CRM_REMINDER_STATUS',
      message: `CRM lembrete ${status}: ${tenantId}`,
      companyId: tenantId,
      before: { id: reminderId },
      after: reminder as unknown as Record<string, unknown>,
      meta: { reminderId, status },
    });
    res.json({ ok: true, reminder });
  } catch (error) {
    sendError(res, error);
  }
}
