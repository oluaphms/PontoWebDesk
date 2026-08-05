import '../src/loadEnv.js';
import { pool } from '../src/db/index.js';

const companyId = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';
const userId = 'dc1c2aad-302e-448b-aa63-8f890d25c95e';

async function main(): Promise<void> {
  const company = await pool.queryTrustedBootstrap(
    `select id::text, name, commercial_blocked, commercial_block_reason,
            company_session_version::text as company_session_version,
            license_status, subscription_status, plan
       from public.companies where id::text = $1`,
    [companyId],
  );
  const user = await pool.queryTrustedBootstrap(
    `select id::text, email, role, status, company_id::text
       from public.users where id::text = $1`,
    [userId],
  );
  const tenants = await pool.queryTrustedBootstrap(
    `select id, operational_company_id::text, status, plan, mode
       from public.master_tenants
      where operational_company_id::text = $1 or id::text = $1
      limit 5`,
    [companyId],
  );
  const tenantIds = tenants.rows.map((t) => String(t.id));
  let licenses: unknown[] = [];
  let subscriptions: unknown[] = [];
  if (tenantIds.length) {
    const lic = await pool.queryTrustedBootstrap(
      `select id, tenant_id, status, starts_at, expires_at, blocked_reason
         from public.master_licenses
        where tenant_id = any($1::text[])
        order by updated_at desc nulls last
        limit 10`,
      [tenantIds],
    );
    licenses = lic.rows;
    const sub = await pool.queryTrustedBootstrap(
      `select id, tenant_id, status, expires_at, plan_code
         from public.master_subscriptions
        where tenant_id = any($1::text[])
        order by updated_at desc nulls last
        limit 10`,
      [tenantIds],
    ).catch(() => ({ rows: [] as unknown[] }));
    subscriptions = sub.rows;
  }

  console.log(
    JSON.stringify(
      {
        company: company.rows[0] ?? null,
        user: user.rows[0] ?? null,
        tenants: tenants.rows,
        licenses,
        subscriptions,
      },
      null,
      2,
    ),
  );
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
