import { Router } from 'express';
import {
  repEmptyCommandsController,
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
router.get('/commands', repEmptyCommandsController);

export default router;
