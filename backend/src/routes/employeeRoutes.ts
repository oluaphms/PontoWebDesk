import { Router } from 'express';
import {
  createEmployeeController,
  deleteEmployeeController,
  listEmployeesController,
  updateEmployeeController,
} from '../controllers/employeeController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/', authMiddleware, listEmployeesController);
router.post('/', authMiddleware, createEmployeeController);
router.patch('/:id', authMiddleware, updateEmployeeController);
router.delete('/:id', authMiddleware, deleteEmployeeController);

export default router;
