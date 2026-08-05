/**
 * Remove master_subscriptions cujo tenant_id não existe mais.
 * Uso: npx tsx scripts/cleanup_orphan_subscriptions.ts [--apply]
 */
import '../src/loadEnv.js';
import { pool } from '../src/db/index.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const orphans = await pool.queryMaster<{
    id: string;
    tenant_id: string | null;
    status: string | null;
  }>(
    `select s.id::text as id, s.tenant_id::text as tenant_id, s.status
       from public.master_subscriptions s
      where s.tenant_id is null
         or not exists (
           select 1 from public.master_tenants t where t.id::text = s.tenant_id::text
         )`,
  );
  console.log({ mode: apply ? 'APPLY' : 'DRY_RUN', orphans: orphans.rows });
  if (!orphans.rows.length) {
    await pool.end();
    return;
  }
  if (!apply) {
    console.log('Dry-run OK. Rode com --apply para remover.');
    await pool.end();
    return;
  }
  const ids = orphans.rows.map((r) => r.id);
  // Finance/notifications first (best-effort) then subscriptions.
  for (const id of ids) {
    const tenantId = orphans.rows.find((r) => r.id === id)?.tenant_id;
    if (tenantId) {
      await pool.queryMaster(
        `delete from public.master_subscription_notifications where tenant_id = $1`,
        [tenantId],
      ).catch(() => undefined);
      await pool.queryMaster(
        `delete from public.master_subscription_finance_entries where tenant_id = $1`,
        [tenantId],
      ).catch(() => undefined);
    }
  }
  const deleted = await pool.queryMaster(
    `delete from public.master_subscriptions where id::text = any($1::text[]) returning id::text as id`,
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
