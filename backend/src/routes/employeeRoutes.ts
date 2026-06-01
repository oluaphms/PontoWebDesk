import { Router } from 'express';
import {
  createEmployeeController,
  deleteEmployeeController,
  getEmployeeController,
  listEmployeesController,
  updateEmployeeController,
} from '../controllers/employeeController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { requireAdminOrHr } from '../middlewares/requireRole.js';

const router = Router();

router.get('/', authMiddleware, listEmployeesController);
router.get('/:id', authMiddleware, getEmployeeController);
router.post('/', authMiddleware, requireAdminOrHr, createEmployeeController);
router.patch('/:id', authMiddleware, requireAdminOrHr, updateEmployeeController);
router.delete('/:id', authMiddleware, requireAdminOrHr, deleteEmployeeController);

export default router;
