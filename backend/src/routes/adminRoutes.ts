import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { requireAdminOrHr } from '../middlewares/requireRole.js';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import type { Response } from 'express';
import { requireCompanyId } from '../utils/authContext.js';
import { adminSetPasswordController } from '../controllers/adminSetPasswordController.js';

/** Rotas administrativas isoladas — não passam pelo CRUD genérico /data. */
const router = Router();

router.use(authMiddleware);
router.use(requireAdminOrHr);

/** Login LOCAL_API: bcrypt em public.users (substitui Supabase Auth na VPS). */
router.post('/set-password', adminSetPasswordController);

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
    console.error('[ADMIN health-scope]', e);
    res.status(500).json({ ok: false, error: 'admin_scope_failed' });
  }
});

export default router;
