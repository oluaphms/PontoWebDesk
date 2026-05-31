import { Router } from 'express';
import { loginController } from '../controllers/authController.js';
import { authMeController } from '../controllers/authMeController.js';
import { authLogoutController } from '../controllers/authLogoutController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { rateLimit } from '../middlewares/rateLimit.js';

const router = Router();

router.post('/login', rateLimit({
  keyPrefix: 'auth:login',
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,
  key: (req) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    return String(body.identifier ?? body.email ?? '');
  },
}), loginController);
router.get('/me', authMiddleware, authMeController);
router.post('/logout', authMiddleware, authLogoutController);

export default router;

