import { Router } from 'express';
import { createPunchBatchController, createPunchController } from '../controllers/punchController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/', authMiddleware, createPunchController);
router.post('/batch', authMiddleware, createPunchBatchController);

export default router;

