import { Router } from 'express';
import {
  countDataController,
  deleteDataController,
  insertDataController,
  listDataController,
  publicGlobalSettingsController,
  rpcDataController,
  updateDataController,
} from '../controllers/dataController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { dataApiWriteGate } from '../middlewares/dataApiGate.js';

const router = Router();

router.get('/global_settings', publicGlobalSettingsController);
router.use(authMiddleware);
router.use(dataApiWriteGate);

router.post('/rpc/:fn', rpcDataController);
router.get('/:table/count', countDataController);
router.get('/:table', listDataController);
router.post('/:table', insertDataController);
router.patch('/:table/:id', updateDataController);
router.delete('/:table/:id', deleteDataController);

export default router;
