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

export default router;
