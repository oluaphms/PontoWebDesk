/**
 * LGPD na VPS (Express) — paridade mínima com /api/lgpd/* serverless.
 * Escopo sempre pelo companyId do JWT. Sem senha em claro. Sem cross-tenant.
 */
import { Router, type Response } from 'express';
import { authMiddleware, type AuthedRequest } from '../middlewares/authMiddleware.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { pool } from '../db/index.js';
import { isAdminOrHr } from '../utils/authContext.js';
import { logger } from '../logger/logger.js';

const router = Router();

const lgpdLimit = rateLimit({
  keyPrefix: 'lgpd',
  maxRequests: 20,
  windowMs: 15 * 60 * 1000,
  key: (req) => {
    const auth = (req as AuthedRequest).auth;
    return String(auth?.userId ?? auth?.sub ?? '');
  },
});

function actor(req: AuthedRequest): { userId: string; companyId: string; role: string } | null {
  const userId = String(req.auth?.userId || req.auth?.sub || '').trim();
  const companyId = String(req.auth?.companyId || '').trim();
  const role = String(req.auth?.role || '').trim();
  if (!userId || !companyId) return null;
  return { userId, companyId, role };
}

function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ ok: false, code, error: message, message });
}

async function auditLgpd(params: {
  companyId: string;
  actorUserId: string;
  action: string;
  targetUserId: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await pool.query(
      `insert into public.audit_logs (company_id, actor_user_id, action, resource, message, meta, created_at)
       values ($1,$2,$3,'lgpd',$4,$5::jsonb,now())`,
      [
        params.companyId,
        params.actorUserId,
        params.action,
        `LGPD ${params.action} → ${params.targetUserId}`,
        JSON.stringify(params.meta ?? {}),
      ],
    );
  } catch {
    // Tabela pode não existir em todas as instalações — best-effort.
    logger.info({
      module: 'lgpd',
      action: params.action,
      companyId: params.companyId,
      userId: params.actorUserId,
      message: 'LGPD event (audit_logs indisponível)',
      meta: { targetUserId: params.targetUserId, ...(params.meta ?? {}) },
    });
  }
}

router.get('/status', authMiddleware, (_req, res) => {
  res.json({
    ok: true,
    lgpd: {
      export: true,
      delete: true,
      consent: true,
      retention: false,
      note: 'Paridade VPS mínima — retenção automática permanece no path Supabase/cron.',
    },
  });
});

router.get('/export', authMiddleware, lgpdLimit, async (req: AuthedRequest, res: Response) => {
  const me = actor(req);
  if (!me) {
    deny(res, 401, 'UNAUTHORIZED', 'Sessão inválida.');
    return;
  }
  const targetUserId = String(req.query.user_id || req.query.employee_id || me.userId).trim();
  const canAccess = targetUserId === me.userId || isAdminOrHr(me.role);
  if (!canAccess) {
    deny(res, 403, 'LGPD_FORBIDDEN', 'Acesso negado a dados de outro titular.');
    return;
  }

  try {
    const userResult = await pool.query(
      `select id::text as id, email, nome, role, company_id::text as company_id,
              phone, cargo, created_at, updated_at
         from public.users
        where id::text = $1 and company_id::text = $2
        limit 1`,
      [targetUserId, me.companyId],
    );
    const profile = userResult.rows[0];
    if (!profile) {
      deny(res, 404, 'LGPD_SUBJECT_NOT_FOUND', 'Titular não encontrado nesta empresa.');
      return;
    }

    let punches: unknown[] = [];
    try {
      const punchResult = await pool.query(
        `select id::text as id, punched_at, source, created_at
           from public.time_records
          where company_id::text = $1
            and (employee_id::text = $2 or user_id::text = $2)
          order by punched_at desc nulls last
          limit 500`,
        [me.companyId, targetUserId],
      );
      punches = punchResult.rows;
    } catch {
      punches = [];
    }

    await auditLgpd({
      companyId: me.companyId,
      actorUserId: me.userId,
      action: 'LGPD_EXPORT',
      targetUserId,
      meta: { punchCount: punches.length },
    });

    res.json({
      ok: true,
      exportedAt: new Date().toISOString(),
      profile,
      time_records: punches,
      note: 'Portabilidade LGPD — dados do titular no escopo da empresa autenticada.',
    });
  } catch (error) {
    logger.error({
      module: 'lgpd',
      action: 'LGPD_EXPORT_FAILED',
      message: 'Falha no export LGPD',
      error,
      companyId: me.companyId,
      userId: me.userId,
    });
    deny(res, 500, 'LGPD_EXPORT_FAILED', 'Falha ao exportar dados do titular.');
  }
});

router.post('/consent', authMiddleware, lgpdLimit, async (req: AuthedRequest, res: Response) => {
  const me = actor(req);
  if (!me) {
    deny(res, 401, 'UNAUTHORIZED', 'Sessão inválida.');
    return;
  }
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const accepted = Boolean(body.accepted);
  const version = String(body.version || '1.0').trim().slice(0, 32);
  const targetUserId = String(body.user_id || me.userId).trim();
  if (targetUserId !== me.userId && !isAdminOrHr(me.role)) {
    deny(res, 403, 'LGPD_FORBIDDEN', 'Somente o titular ou admin/RH pode registrar consentimento.');
    return;
  }

  try {
    await pool.query(
      `insert into public.consent_logs (user_id, company_id, accepted, version, created_at)
       values ($1,$2,$3,$4,now())`,
      [targetUserId, me.companyId, accepted, version],
    );
  } catch {
    // Fallback: apenas auditoria se a tabela ainda não existir.
  }

  await auditLgpd({
    companyId: me.companyId,
    actorUserId: me.userId,
    action: 'LGPD_CONSENT',
    targetUserId,
    meta: { accepted, version },
  });

  res.json({ ok: true, accepted, version, recordedAt: new Date().toISOString() });
});

router.post('/delete', authMiddleware, lgpdLimit, async (req: AuthedRequest, res: Response) => {
  const me = actor(req);
  if (!me) {
    deny(res, 401, 'UNAUTHORIZED', 'Sessão inválida.');
    return;
  }
  if (!isAdminOrHr(me.role)) {
    deny(res, 403, 'LGPD_FORBIDDEN', 'Somente admin/RH pode anonimizar titular.');
    return;
  }
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const targetUserId = String(body.user_id || '').trim();
  if (!targetUserId) {
    deny(res, 400, 'VALIDATION_ERROR', 'user_id é obrigatório.');
    return;
  }
  if (targetUserId === me.userId) {
    deny(res, 400, 'LGPD_SELF_DELETE_FORBIDDEN', 'Não é permitido anonimizar a própria sessão ativa por esta rota.');
    return;
  }

  try {
    const exists = await pool.query(
      `select id::text as id from public.users
        where id::text = $1 and company_id::text = $2 limit 1`,
      [targetUserId, me.companyId],
    );
    if (!exists.rows[0]) {
      deny(res, 404, 'LGPD_SUBJECT_NOT_FOUND', 'Titular não encontrado nesta empresa.');
      return;
    }

    // Campos opcionais variam por schema — aplica o núcleo e tenta enriquecer.
    await pool.query(
      `update public.users
          set email = concat('anon+', id::text, '@lgpd.local'),
              nome = 'Titular anonimizado'
        where id::text = $1
          and company_id::text = $2`,
      [targetUserId, me.companyId],
    );
    await pool
      .query(
        `update public.users
            set phone = null,
                password_hash = null,
                status = 'inactive',
                updated_at = now()
          where id::text = $1 and company_id::text = $2`,
        [targetUserId, me.companyId],
      )
      .catch(() => undefined);

    await auditLgpd({
      companyId: me.companyId,
      actorUserId: me.userId,
      action: 'LGPD_ANONYMIZE',
      targetUserId,
    });

    res.json({
      ok: true,
      anonymizedUserId: targetUserId,
      anonymizedAt: new Date().toISOString(),
      note: 'Anonimização aplicada no perfil operacional. Auth provider externo deve ser tratado separadamente se aplicável.',
    });
  } catch (error) {
    logger.error({
      module: 'lgpd',
      action: 'LGPD_DELETE_FAILED',
      message: 'Falha na anonimização LGPD',
      error,
      companyId: me.companyId,
      userId: me.userId,
    });
    deny(res, 500, 'LGPD_DELETE_FAILED', 'Falha ao anonimizar titular.');
  }
});

export default router;
