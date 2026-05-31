import { Router } from 'express';
import authRoutes from './authRoutes.js';
import employeeRoutes from './employeeRoutes.js';
import punchRoutes from './punchRoutes.js';
import dataRoutes from './dataRoutes.js';
import adminRoutes from './adminRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';

/** Rotas da API — montadas em `app.use('/api', apiRouter)`. */
const apiRouter = Router();

apiRouter.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    logger.error({
      module: 'http.health',
      action: 'HEALTH_CHECK_FAILED',
      message: 'Falha no health check',
      error: err,
    });
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

apiRouter.get('/health/db', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    logger.error({
      module: 'http.health',
      action: 'HEALTH_DB_CHECK_FAILED',
      message: 'Falha no health/db check',
      error: err,
    });
    res.status(500).json({ status: 'error', db: 'down' });
  }
});

apiRouter.use('/auth', authRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/employees', employeeRoutes);
apiRouter.use('/punches', punchRoutes);
apiRouter.use('/data', dataRoutes);
apiRouter.use('/uploads', uploadRoutes);

export default apiRouter;
