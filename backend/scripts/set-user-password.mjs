/**
 * Define password_hash (login API) para um e-mail em public.users.
 * Se o e-mail não existir, lista utilizadores disponíveis.
 *
 * Uso:
 *   EMAIL=seu@email.com PASSWORD=admin123 node scripts/set-user-password.mjs
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL?.trim();
const email = (process.env.EMAIL || process.argv[2] || '').trim().toLowerCase();
const password = process.env.PASSWORD || process.argv[3] || 'admin123';
const role = (process.env.ROLE || 'admin').trim();

if (!connectionString) {
  console.error('[set-password] Defina DATABASE_URL em backend/.env');
  process.exit(1);
}
if (!email) {
  console.error('[set-password] Uso: EMAIL=seu@email.com PASSWORD=senha node scripts/set-user-password.mjs');
  process.exit(1);
}

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const pool = new pg.Pool({ connectionString, ssl });

async function listUsers(client) {
  const r = await client.query(
    `select id::text, email, role, company_id::text as company_id,
            case when password_hash is null or password_hash = '' then 'SEM_SENHA' else 'OK' end as senha_api
     from users
     order by case when role in ('admin','hr') then 0 else 1 end, email
     limit 25`,
  );
  if (!r.rowCount) {
    console.log('[set-password] Tabela public.users está vazia — importe o dump ou rode db:seed.');
    const auth = await client.query(
      `select id::text, email from auth.users order by email limit 15`,
    ).catch(() => ({ rows: [] }));
    if (auth.rows?.length) {
      console.log('[set-password] Utilizadores só em auth.users (falta linha em public.users):');
      for (const row of auth.rows) console.log('  -', row.email, row.id);
    }
    return;
  }
  console.log('[set-password] Utilizadores em public.users (senha_api = login VPS):');
  for (const row of r.rows) {
    console.log(`  - ${row.email} | role=${row.role} | senha=${row.senha_api} | company=${row.company_id}`);
  }
  console.log('[set-password] Senha do Supabase Auth NÃO migra — use este script ou db:seed.');
}

try {
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    const upd = await client.query(
      `update users
       set password_hash = $1,
           role = case when $2 <> '' then $2 else role end
       where lower(trim(email)) = $3
       returning id::text, email, role, company_id::text`,
      [hash, role, email],
    );
    if (upd.rowCount > 0) {
      console.log('[set-password] OK — login API ativo para:');
      console.log(upd.rows[0]);
      console.log('[set-password] Senha definida (não é exibida). Use no app:', email);
      process.exit(0);
    }
    console.warn('[set-password] E-mail não encontrado:', email);
    await listUsers(client);
    process.exit(2);
  } finally {
    client.release();
  }
} catch (err) {
  console.error('[set-password] Falhou:', err.message || err);
  process.exit(1);
} finally {
  await pool.end();
}
