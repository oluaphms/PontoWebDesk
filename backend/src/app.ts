import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import employeeRoutes from './routes/employeeRoutes.js';
import punchRoutes from './routes/punchRoutes.js';
import dataRoutes from './routes/dataRoutes.js';
import { checkDatabaseConnection } from './db/index.js';

export const app = express();

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  console.log('[API]', req.path);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/health', async (_req, res) => {
  const dbOk = await checkDatabaseConnection();
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    database: dbOk ? 'connected' : 'unavailable',
    provider: 'hostinger-postgres',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/punches', punchRoutes);
app.use('/api/data', dataRoutes);

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'not_found' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API_ERROR]', err);
  res.status(500).json({ ok: false, error: 'internal_error' });
});

