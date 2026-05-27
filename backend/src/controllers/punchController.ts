import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { insertPunchBatchSafe, insertPunchSafe } from '../services/punchService.js';
import { authUserId, isAdminOrHr, rejectTenantOverride, requireCompanyId } from '../utils/authContext.js';
import { logAuthDenied } from '../services/authAuditService.js';

type PunchBody = Record<string, unknown>;

function mergePunchBody(req: AuthedRequest, item: PunchBody): PunchBody | { error: string } {
  const auth = req.auth;
  const selfId = authUserId(auth);
  const jwtCompany = String(auth?.companyId ?? '').trim();
  const userFromBody = String(item.user_id ?? item.userId ?? '').trim();
  const companyFromBody = String(item.company_id ?? item.companyId ?? '').trim();

  let userId = selfId;
  let companyId = jwtCompany;

  const privileged = isAdminOrHr(auth?.role);

  if (userFromBody && userFromBody !== selfId) {
    if (!privileged) {
      return { error: 'forbidden_user' };
    }
    userId = userFromBody;
  }

  if (companyFromBody && companyFromBody !== jwtCompany) {
    if (!privileged) {
      return { error: 'forbidden_tenant' };
    }
    companyId = companyFromBody;
  }

  if (!userId || !companyId) {
    return { error: 'missing_scope' };
  }

  return {
    ...item,
    user_id: userId,
    company_id: companyId,
    type: String(item.type ?? '').trim(),
    timestamp: item.timestamp ?? new Date().toISOString(),
  };
}

export async function createPunchController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  if (!requireCompanyId(req, res)) return;

  try {
    const raw = req.body && typeof req.body === 'object' ? (req.body as PunchBody) : {};
    const merged = mergePunchBody(req, raw);
    if ('error' in merged) {
      if (merged.error === 'forbidden_user' || merged.error === 'forbidden_tenant') {
        void logAuthDenied(req, 403, String(merged.error));
        res.status(403).json({ ok: false, error: merged.error, message: 'Não pode registrar ponto para outro usuário.' });
        return;
      }
      res.status(400).json({
        ok: false,
        error: merged.error,
        message: 'Token sem user/empresa.',
      });
      return;
    }

    if (!merged.type) {
      res.status(400).json({ ok: false, error: 'missing_type', message: 'Informe type (ex.: entrada, saida, pausa).' });
      return;
    }

    const result = await insertPunchSafe(merged);
    if (!result.success) {
      res.status(400).json({ ok: false, error: 'invalid_punch', result });
      return;
    }
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[PUNCH]', e);
    res.status(500).json({ ok: false, error: 'punch_failed' });
  }
}

export async function createPunchBatchController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  if (!requireCompanyId(req, res)) return;

  try {
    const raw = Array.isArray(req.body?.punches) ? req.body.punches : [];
    const punches: PunchBody[] = [];
    for (const item of raw) {
      const merged = mergePunchBody(req, item && typeof item === 'object' ? (item as PunchBody) : {});
      if ('error' in merged) {
        void logAuthDenied(req, 403, String(merged.error));
        res.status(403).json({ ok: false, error: merged.error, message: 'Batch contém escopo não permitido.' });
        return;
      }
      punches.push(merged);
    }
    const results = await insertPunchBatchSafe(punches);
    res.json({ ok: true, results });
  } catch (e) {
    console.error('[PUNCH BATCH]', e);
    res.status(500).json({ ok: false, error: 'punch_batch_failed', results: [] });
  }
}
