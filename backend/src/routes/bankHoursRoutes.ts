import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  createManualAdjustmentController,
  listLedgerSummaryController,
  listPendingFlowRequestsController,
  reviewCompensationController,
  reviewOvertimeController,
  requestCompensationController,
  requestOvertimeController,
} from '../controllers/bankHoursController.js';
import { bankHoursApiRateLimit } from '../middlewares/apiRateLimitPresets.js';

const router = Router();

router.use(bankHoursApiRateLimit);
router.use(authMiddleware);

router.get('/summary', listLedgerSummaryController);
router.get('/requests', listPendingFlowRequestsController);
router.post('/manual-adjustments', createManualAdjustmentController);
router.post('/overtime-requests', requestOvertimeController);
router.post('/overtime-requests/review', reviewOvertimeController);
router.post('/compensation-requests', requestCompensationController);
router.post('/compensation-requests/review', reviewCompensationController);

export default router;
