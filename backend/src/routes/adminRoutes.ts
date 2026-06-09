import { observabilityConsole } from '../logger/observabilityConsole.js';
import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { requireAdminOrHr } from '../middlewares/requireRole.js';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import type { Response } from 'express';
import { requireCompanyId } from '../utils/authContext.js';
import { adminSetPasswordController } from '../controllers/adminSetPasswordController.js';
import {
  getGlobalSettingsController,
  upsertGlobalSettingsController,
} from '../controllers/globalSettingsController.js';
import { rateLimit } from '../middlewares/rateLimit.js';

/** Rotas administrativas isoladas — não passam pelo CRUD genérico /data. */
const router = Router();

router.use(authMiddleware);
router.use(requireAdminOrHr);

/** Login LOCAL_API: bcrypt em public.users (substitui Supabase Auth na VPS). */
router.get('/global-settings', getGlobalSettingsController);
router.put('/global-settings', upsertGlobalSettingsController);
router.post('/global-settings', upsertGlobalSettingsController);

router.post('/set-password', rateLimit({
  keyPrefix: 'auth:set-password',
  maxRequests: 10,
  windowMs: 15 * 60 * 1000,
  key: (req) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    return String(body.email ?? body.Email ?? '');
  },
}), adminSetPasswordController);

router.get('/health-scope', async (req: AuthedRequest, res: Response) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  try {
    const [employees, users] = await Promise.all([
      pool.query('SELECT count(*)::int AS c FROM public.employees WHERE company_id = $1', [companyId]),
      pool.query('SELECT count(*)::int AS c FROM public.users WHERE company_id = $1', [companyId]),
    ]);
    res.json({
      ok: true,
      companyId,
      counts: {
        employees: employees.rows[0]?.c ?? 0,
        users: users.rows[0]?.c ?? 0,
      },
    });
  } catch (e) {
    observabilityConsole.error('[ADMIN health-scope]', e);
    res.status(500).json({ ok: false, error: 'admin_scope_failed' });
  }
});

export default router;
