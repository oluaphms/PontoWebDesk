import { Router } from 'express';
import {
  countDataController,
  deleteDataController,
  insertDataController,
  listDataController,
  authenticatedGlobalSettingsController,
  rpcDataController,
  updateDataController,
} from '../controllers/dataController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { dataApiWriteGate } from '../middlewares/dataApiGate.js';
import { dataApiRateLimit } from '../middlewares/apiRateLimitPresets.js';

const router = Router();

router.use(dataApiRateLimit);

router.get('/global_settings', authMiddleware, authenticatedGlobalSettingsController);
router.use(authMiddleware);
// RPC com allowlist própria (insert_time_record, REP, etc.) — antes do gate de writes genéricos.
router.post('/rpc/:fn', rpcDataController);
router.use(dataApiWriteGate);
router.get('/:table/count', countDataController);
router.get('/:table', listDataController);
router.post('/:table', insertDataController);
router.patch('/:table/:id', updateDataController);
router.delete('/:table/:id', deleteDataController);

export default router;
