import './loadEnv.js';
import { app } from './app.js';
import { checkDatabaseConnection } from './db/index.js';

const port = Number(process.env.PORT || 3000);

async function verifyDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn('[API] DATABASE_URL não definida — configure backend/.env (Hostinger Postgres)');
    return;
  }
  if (await checkDatabaseConnection()) {
    console.log('[API] Postgres conectado (Hostinger/local)');
  } else {
    console.warn('[API] Postgres indisponível — verifique Hostinger / firewall / DATABASE_URL');
  }
}

async function start(): Promise<void> {
  if (!process.env.JWT_SECRET) {
    console.warn('[API] JWT_SECRET ausente — login /api/auth/login não funcionará corretamente');
  }

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[API] server running on 0.0.0.0:${port}`);
      resolve();
    });
    server.on('error', reject);
  });

  void verifyDatabase();
}

start().catch((err) => {
  console.error('[API] falha ao iniciar:', err);
  process.exit(1);
});

