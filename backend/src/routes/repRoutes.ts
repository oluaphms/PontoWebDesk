import { Router } from 'express';
import {
  repCommandResultController,
  repCommandsController,
  repCollectController,
  repExchangeController,
  repForceSyncController,
  repHeartbeatController,
  repPunchesController,
  repPushEmployeeController,
  repSyncStatusController,
} from '../controllers/repController.js';
import { repDiagnosticsController } from '../controllers/repDiagnosticsController.js';
import {
  repAfdImportDeleteController,
  repAfdImportDetailController,
  repAfdImportsListController,
  repImportAfdController,
} from '../controllers/repImportAfdController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/punches', repPunchesController);
router.post('/heartbeat', repHeartbeatController);
router.post('/devices/:deviceId/heartbeat', repHeartbeatController);
router.get('/sync-status', repSyncStatusController);
router.get('/devices/:deviceId/sync-status', repSyncStatusController);
router.post('/devices/:deviceId/force-sync', repForceSyncController);
router.post('/collect', repCollectController);
router.post('/exchange', repExchangeController);
router.post('/push-employee', repPushEmployeeController);
router.get('/commands', repCommandsController);
router.post('/commands', repCommandsController);
router.post('/command-result', repCommandResultController);
router.get('/diagnostics', repDiagnosticsController);
router.post('/import-afd', authMiddleware, repImportAfdController);
router.get('/afd-imports', authMiddleware, repAfdImportsListController);
router.get('/afd-imports/:importId', authMiddleware, repAfdImportDetailController);
router.delete('/afd-imports/:importId', authMiddleware, repAfdImportDeleteController);

export default router;
