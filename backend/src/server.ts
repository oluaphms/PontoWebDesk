import './loadEnv.js';
import { app } from './app.js';
import { checkDatabaseConnection } from './db/index.js';
import { isVpsRlsEnforced } from './db/tenantRls.js';
import { logger } from './logger/logger.js';

const port = Number(process.env.PORT || 3000);

async function verifyDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    logger.warn({
      module: 'bootstrap.server',
      action: 'DATABASE_URL_MISSING',
      message: 'DATABASE_URL não definida',
    });
    return;
  }
  if (await checkDatabaseConnection()) {
    logger.info({
      module: 'bootstrap.server',
      action: 'DATABASE_CONNECTED',
      message: 'Postgres conectado',
    });
  } else {
    logger.warn({
      module: 'bootstrap.server',
      action: 'DATABASE_UNAVAILABLE',
      message: 'Postgres indisponível',
    });
  }
}

async function start(): Promise<void> {
  if (!process.env.JWT_SECRET) {
    logger.warn({
      module: 'bootstrap.server',
      action: 'JWT_SECRET_MISSING',
      message: 'JWT_SECRET ausente',
    });
  }

  if (process.env.NODE_ENV === 'production' && !isVpsRlsEnforced()) {
    logger.warn({
      module: 'bootstrap.server',
      action: 'VPS_RLS_NOT_ENFORCED',
      message:
        'VPS_RLS_ENFORCED=false em produção — ative após aplicar 016_vps_rls_tenant_isolation.sql (ver backend/.env.example)',
    });
  }

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      logger.info({
        module: 'bootstrap.server',
        action: 'SERVER_STARTED',
        message: `API em execução na porta ${port}`,
        meta: { port },
      });
      resolve();
    });
    server.on('error', reject);
  });

  void verifyDatabase();
}

start().catch((err) => {
  logger.fatal({
    module: 'bootstrap.server',
    action: 'SERVER_START_FAILED',
    message: 'Falha ao iniciar API',
    error: err,
  });
  process.exit(1);
});

