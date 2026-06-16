import { Router } from 'express';
import { createPunchBatchController, createPunchController } from '../controllers/punchController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { punchesApiRateLimit } from '../middlewares/apiRateLimitPresets.js';

const router = Router();

router.use(punchesApiRateLimit);

router.post('/', authMiddleware, createPunchController);
router.post('/batch', authMiddleware, createPunchBatchController);

export default router;

