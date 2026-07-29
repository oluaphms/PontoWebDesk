/**
 * Diagnóstico rápido dos usuários golive órfãos.
 */
import '../src/loadEnv.js';
import { pool } from '../src/db/index.js';

async function main() {
  const u = await pool.queryTrustedBootstrap(
    `select id::text, email, company_id::text, role, status, nome
       from public.users
      where company_id::text = $1
         or lower(email) like '%.golive@pontowebdesk.local'`,
    ['029e9835-20da-55bc-8543-dc231e4277ec'],
  );
  console.log('USERS', JSON.stringify(u.rows, null, 2));

  const t = await pool.queryMaster(
    `select id::text, company_name, operational_company_id::text, status
       from public.master_tenants
      where operational_company_id::text = $1`,
    ['029e9835-20da-55bc-8543-dc231e4277ec'],
  );
  console.log('TENANTS', t.rows);

  const c = await pool.queryTrustedBootstrap(
    `select id::text, name from public.companies where id::text = $1`,
    ['029e9835-20da-55bc-8543-dc231e4277ec'],
  );
  console.log('COMPANY', c.rows);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
