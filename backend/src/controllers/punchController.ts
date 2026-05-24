import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { insertPunchBatchSafe, insertPunchSafe } from '../services/punchService.js';

type PunchBody = Record<string, unknown>;

function authUserId(auth: AuthedRequest['auth']): string {
  if (!auth) return '';
  const raw = auth as { sub?: string; userId?: string };
  return String(raw.sub || raw.userId || '').trim();
}

/** Preenche user_id e company_id a partir do JWT quando o cliente envia só `type`. */
function mergePunchBody(req: AuthedRequest, item: PunchBody): PunchBody {
  const auth = req.auth;
  const userFromBody = String(item.user_id ?? item.userId ?? '').trim();
  const companyFromBody = String(item.company_id ?? item.companyId ?? '').trim();
  return {
    ...item,
    user_id: userFromBody || authUserId(auth),
    company_id: companyFromBody || String(auth?.companyId ?? '').trim(),
    type: String(item.type ?? '').trim(),
    timestamp: item.timestamp ?? new Date().toISOString(),
  };
}

export async function createPunchController(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const body = mergePunchBody(req, (req.body && typeof req.body === 'object' ? req.body : {}) as PunchBody);
    if (!body.type) {
      res.status(400).json({ ok: false, error: 'missing_type', message: 'Informe type (ex.: entrada, saida, pausa).' });
      return;
    }
    if (!body.user_id || !body.company_id) {
      res.status(400).json({
        ok: false,
        error: 'missing_scope',
        message: 'Token sem user/empresa ou envie user_id e company_id no body.',
      });
      return;
    }

    const result = await insertPunchSafe(body);
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
  try {
    const raw = Array.isArray(req.body?.punches) ? req.body.punches : [];
    const punches = raw.map((item) =>
      mergePunchBody(req, item && typeof item === 'object' ? (item as PunchBody) : {}),
    );
    const results = await insertPunchBatchSafe(punches);
    res.json({ ok: true, results });
  } catch (e) {
    console.error('[PUNCH BATCH]', e);
    res.status(500).json({ ok: false, error: 'punch_batch_failed', results: [] });
  }
}

