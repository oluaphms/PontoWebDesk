import dotenv from 'dotenv';
import { app } from './app.js';
import { checkDatabaseConnection } from './db/index.js';

dotenv.config();

const port = Number(process.env.PORT || 3000);

async function start(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn('[API] DATABASE_URL não definida — configure backend/.env (Hostinger Postgres)');
  } else if (!(await checkDatabaseConnection())) {
    console.warn('[API] Postgres indisponível — verifique Hostinger / firewall / DATABASE_URL');
  } else {
    console.log('[API] Postgres conectado (Hostinger/local)');
  }

  if (!process.env.JWT_SECRET) {
    console.warn('[API] JWT_SECRET ausente — login /api/auth/login não funcionará corretamente');
  }

  app.listen(port, () => {
    console.log(`[API] server running on :${port}`);
  });
}

void start();

