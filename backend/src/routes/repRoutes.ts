import { Router } from 'express';
import {
  repCommandResultController,
  repCommandsController,
  repCollectController,
  repForceSyncController,
  repHeartbeatController,
  repPunchesController,
  repSyncStatusController,
} from '../controllers/repController.js';

const router = Router();

router.post('/punches', repPunchesController);
router.post('/heartbeat', repHeartbeatController);
router.post('/devices/:deviceId/heartbeat', repHeartbeatController);
router.get('/sync-status', repSyncStatusController);
router.get('/devices/:deviceId/sync-status', repSyncStatusController);
router.post('/devices/:deviceId/force-sync', repForceSyncController);
router.post('/collect', repCollectController);
router.get('/commands', repCommandsController);
router.post('/commands', repCommandsController);
router.post('/command-result', repCommandResultController);

export default router;
