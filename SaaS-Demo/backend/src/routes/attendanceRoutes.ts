import { Router } from 'express';
import { attendancePeriodController } from '../controllers/attendancePeriodController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { requireAdminOrHr } from '../middlewares/requireRole.js';
import { dataApiRateLimit } from '../middlewares/apiRateLimitPresets.js';

const router = Router();

router.use(dataApiRateLimit);
router.get('/period', authMiddleware, requireAdminOrHr, attendancePeriodController);

export default router;
