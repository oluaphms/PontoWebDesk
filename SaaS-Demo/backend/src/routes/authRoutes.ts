import { Router } from 'express';
import { loginController } from '../controllers/authController.js';
import { authChangePasswordController } from '../controllers/authPasswordController.js';
import { authMeController } from '../controllers/authMeController.js';
import { authLogoutController } from '../controllers/authLogoutController.js';
import { authRecoveryCompleteController } from '../controllers/authRecoveryController.js';
import { authResetPasswordController } from '../controllers/authResetPasswordController.js';
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
router.post('/reset-password', rateLimit({
  keyPrefix: 'auth:reset-password',
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,
  key: (req) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    return String(body.email ?? '');
  },
}), authResetPasswordController);
router.post('/recovery/complete', rateLimit({
  keyPrefix: 'auth:recovery-complete',
  maxRequests: 8,
  windowMs: 15 * 60 * 1000,
  key: (req) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    return String(body.access_token ?? body.accessToken ?? req.ip ?? '');
  },
}), authRecoveryCompleteController);
router.get('/me', authMiddleware, authMeController);
router.post('/change-password', authMiddleware, rateLimit({
  keyPrefix: 'auth:change-password',
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,
  key: (req) => {
    const auth = (req as { auth?: { sub?: string; userId?: string } }).auth;
    return String(auth?.sub ?? auth?.userId ?? req.ip ?? '');
  },
}), authChangePasswordController);
router.post('/logout', authMiddleware, authLogoutController);

export default router;

