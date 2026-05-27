import { Router } from 'express';
import { loginController } from '../controllers/authController.js';
import { authMeController } from '../controllers/authMeController.js';
import { authLogoutController } from '../controllers/authLogoutController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/login', loginController);
router.get('/me', authMiddleware, authMeController);
router.post('/logout', authMiddleware, authLogoutController);

export default router;

