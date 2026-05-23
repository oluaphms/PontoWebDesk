import { Router } from 'express';
import {
  countDataController,
  deleteDataController,
  insertDataController,
  listDataController,
  rpcDataController,
  updateDataController,
} from '../controllers/dataController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.post('/rpc/:fn', rpcDataController);
router.get('/:table/count', countDataController);
router.get('/:table', listDataController);
router.post('/:table', insertDataController);
router.patch('/:table/:id', updateDataController);
router.delete('/:table/:id', deleteDataController);

export default router;
