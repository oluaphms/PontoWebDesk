import { Router } from 'express';
import {
  repCommandResultController,
  repCommandsController,
  repCollectController,
  repExchangeController,
  repForceSyncController,
  repHeartbeatController,
  repPunchesController,
  repPromotePendingController,
  repPushEmployeeController,
  repStatusController,
  repSyncStatusController,
} from '../controllers/repController.js';
import { repDiagnosticsController } from '../controllers/repDiagnosticsController.js';
import { repDebugStatusController } from '../controllers/repDebugStatusController.js';
import {
  repAfdImportDeleteController,
  repAfdImportDetailController,
  repAfdImportsListController,
  repImportAfdController,
} from '../controllers/repImportAfdController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { repAgentVersionController } from '../controllers/repAgentVersionController.js';
import { repDeviceCredentialsController } from '../controllers/repDeviceCredentialsController.js';
import {
  createRepDeviceController,
  deleteRepDeviceController,
  patchRepDeviceController,
} from '../controllers/repDeviceWriteController.js';
import { repApiRateLimit } from '../middlewares/apiRateLimitPresets.js';

const router = Router();

router.use(repApiRateLimit);

router.get('/agent-version', repAgentVersionController);
router.post('/devices', authMiddleware, createRepDeviceController);
router.patch('/devices/:deviceId', authMiddleware, patchRepDeviceController);
router.delete('/devices/:deviceId', authMiddleware, deleteRepDeviceController);
router.post('/devices/:deviceId/credentials', authMiddleware, repDeviceCredentialsController);

router.post('/punches', repPunchesController);
router.post('/heartbeat', repHeartbeatController);
router.post('/devices/:deviceId/heartbeat', repHeartbeatController);
router.get('/sync-status', repSyncStatusController);
router.get('/devices/:deviceId/sync-status', repSyncStatusController);
router.post('/devices/:deviceId/force-sync', repForceSyncController);
router.post('/collect', repCollectController);
router.post('/exchange', repExchangeController);
router.post('/push-employee', repPushEmployeeController);
router.post('/promote-pending', repPromotePendingController);
router.get('/status', repStatusController);
router.get('/commands', repCommandsController);
router.post('/commands', repCommandsController);
router.post('/command-result', repCommandResultController);
router.get('/diagnostics', repDiagnosticsController);
router.get('/debug-status', repDebugStatusController);
router.post('/import-afd', authMiddleware, repImportAfdController);
router.get('/afd-imports', authMiddleware, repAfdImportsListController);
router.get('/afd-imports/:importId', authMiddleware, repAfdImportDetailController);
router.delete('/afd-imports/:importId', authMiddleware, repAfdImportDeleteController);

export default router;
