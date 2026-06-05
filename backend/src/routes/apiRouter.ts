import { Router } from 'express';
import authRoutes from './authRoutes.js';
import employeeRoutes from './employeeRoutes.js';
import punchRoutes from './punchRoutes.js';
import dataRoutes from './dataRoutes.js';
import adminRoutes from './adminRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import bankHoursRoutes from './bankHoursRoutes.js';
import repRoutes from './repRoutes.js';
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

apiRouter.get('/health/time', async (_req, res) => {
  const serverNow = new Date();
  try {
    const result = await pool.query(
      `select
         clock_timestamp() as db_clock,
         now() as db_now,
         current_setting('TIMEZONE') as db_timezone,
         extract(epoch from clock_timestamp()) * 1000 as db_epoch_ms`,
    );
    const row = result.rows[0] ?? {};
    const dbClock = row.db_clock instanceof Date ? row.db_clock : new Date(row.db_clock);
    res.json({
      ok: true,
      serverTime: serverNow.toISOString(),
      serverEpochMs: serverNow.getTime(),
      dbTime: Number.isNaN(dbClock.getTime()) ? null : dbClock.toISOString(),
      dbNow: row.db_now instanceof Date ? row.db_now.toISOString() : row.db_now ?? null,
      dbEpochMs: Number(row.db_epoch_ms),
      dbTimezone: row.db_timezone ?? null,
      operationalTimezone: 'America/Sao_Paulo',
    });
  } catch (err) {
    logger.error({
      module: 'http.health',
      action: 'HEALTH_TIME_CHECK_FAILED',
      message: 'Falha no health/time check',
      error: err,
    });
    res.status(503).json({
      ok: false,
      serverTime: serverNow.toISOString(),
      serverEpochMs: serverNow.getTime(),
      operationalTimezone: 'America/Sao_Paulo',
      error: 'time_check_failed',
    });
  }
});

apiRouter.use('/auth', authRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/employees', employeeRoutes);
apiRouter.use('/punches', punchRoutes);
apiRouter.use('/rep', repRoutes);
apiRouter.use('/data', dataRoutes);
apiRouter.use('/uploads', uploadRoutes);
apiRouter.use('/bank-hours', bankHoursRoutes);

export default apiRouter;
