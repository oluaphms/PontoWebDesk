/**
 * Remove usuários de seed golive órfãos (company inexistente + sem master_tenant).
 * Uso: npx tsx scripts/cleanup_golive_orphan_users.ts [--apply]
 * Sem --apply: dry-run.
 */
import '../src/loadEnv.js';
import { pool } from '../src/db/index.js';

const ORPHAN_COMPANY_ID = '029e9835-20da-55bc-8543-dc231e4277ec';
const GOLIVE_EMAIL_SUFFIX = '.golive@pontowebdesk.local';

async function main() {
  const apply = process.argv.includes('--apply');

  const users = await pool.queryTrustedBootstrap<{
    id: string;
    email: string;
    company_id: string;
    role: string;
    status: string;
  }>(
    `select id::text as id, email, company_id::text as company_id, role, status
       from public.users
      where company_id::text = $1
         or lower(email) like $2`,
    [ORPHAN_COMPANY_ID, `%${GOLIVE_EMAIL_SUFFIX}`],
  );

  const tenants = await pool.queryMaster(
    `select id::text from public.master_tenants where operational_company_id::text = $1`,
    [ORPHAN_COMPANY_ID],
  );
  const company = await pool.queryTrustedBootstrap(
    `select id::text from public.companies where id::text = $1`,
    [ORPHAN_COMPANY_ID],
  );

  console.log({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    users: users.rows,
    tenants_for_company: tenants.rowCount,
    company_exists: (company.rowCount ?? 0) > 0,
  });

  if ((tenants.rowCount ?? 0) > 0 || (company.rowCount ?? 0) > 0) {
    console.error('ABORT: company ou tenant ainda existem — limpeza golive não é segura.');
    await pool.end();
    process.exit(2);
  }

  if (!users.rows.length) {
    console.log('Nenhum usuário golive órfão encontrado.');
    await pool.end();
    return;
  }

  if (!apply) {
    console.log('Dry-run OK. Rode com --apply para remover.');
    await pool.end();
    return;
  }

  const ids = users.rows.map((u) => u.id);
  const deleted = await pool.queryTrustedBootstrap(
    `delete from public.users
      where id::text = any($1::text[])
      returning id::text as id, email`,
    [ids],
  );
  console.log('DELETED', deleted.rows);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
