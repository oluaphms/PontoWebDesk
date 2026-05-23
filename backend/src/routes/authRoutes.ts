import { Router } from 'express';
import { loginController } from '../controllers/authController.js';
import { authMeController } from '../controllers/authMeController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/login', loginController);
router.get('/me', authMiddleware, authMeController);

export default router;

