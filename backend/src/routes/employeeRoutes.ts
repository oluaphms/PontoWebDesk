import { Router } from 'express';
import { listEmployeesController } from '../controllers/employeeController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/', authMiddleware, listEmployeesController);

export default router;

