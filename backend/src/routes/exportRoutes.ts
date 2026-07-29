import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { exportAejController, exportAfdController } from '../controllers/exportController.js';

const router = Router();

router.get('/afd', authMiddleware, exportAfdController);
router.get('/aej', authMiddleware, exportAejController);
/** Compat: GET /api/export?type=afd|aej */
router.get('/', authMiddleware, (req, res, next) => {
  const type = String(req.query.type || 'afd').toLowerCase();
  if (type === 'aej') return exportAejController(req, res);
  return exportAfdController(req, res);
});

export default router;
