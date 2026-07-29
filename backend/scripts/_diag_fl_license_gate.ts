import '../src/loadEnv.js';
import { pool } from '../src/db/index.js';

const companyId = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';
const tenantId = 'tn_a871a91fb8914670';

async function main(): Promise<void> {
  const company = await pool.queryTrustedBootstrap<{
    id: string;
    name: string | null;
    commercial_blocked: boolean | null;
    commercial_block_reason: string | null;
    company_session_version: number | null;
  }>(
    `select id::text as id, name, commercial_blocked, commercial_block_reason, company_session_version
       from public.companies
      where id::text = $1`,
    [companyId],
  );
  console.log('COMPANY', JSON.stringify(company.rows[0] ?? null, null, 2));

  const cols = await pool.queryMaster<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = 'master_licenses'
      order by ordinal_position`,
  );
  console.log('LICENSE_COLS', cols.rows.map((r) => r.column_name));

  const licenses = await pool.queryMaster<Record<string, unknown>>(
    `select *
       from public.master_licenses
      where tenant_id::text = $1
         or id::text ilike '%07a6ea%'
      order by updated_at desc nulls last
      limit 20`,
    [tenantId],
  );
  console.log('LICENSES', JSON.stringify(licenses.rows, null, 2));

  const users = await pool.queryTrustedBootstrap<{
    email: string;
    role: string;
    status: string | null;
  }>(
    `select email, role, status::text as status
       from public.users
      where company_id::text = $1
      order by email
      limit 20`,
    [companyId],
  );
  console.log('USERS', JSON.stringify(users.rows, null, 2));

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
