import { Router } from 'express';
import authRoutes from './authRoutes.js';
import employeeRoutes from './employeeRoutes.js';
import punchRoutes from './punchRoutes.js';
import dataRoutes from './dataRoutes.js';
import { pool } from '../db/index.js';

/** Rotas da API — montadas em `app.use('/api', apiRouter)`. */
const apiRouter = Router();

apiRouter.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('[HEALTH]', err);
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

apiRouter.get('/health/db', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('[HEALTH/db]', err);
    res.status(500).json({ status: 'error', db: 'down' });
  }
});

apiRouter.use('/auth', authRoutes);
apiRouter.use('/employees', employeeRoutes);
apiRouter.use('/punches', punchRoutes);
apiRouter.use('/data', dataRoutes);

export default apiRouter;
