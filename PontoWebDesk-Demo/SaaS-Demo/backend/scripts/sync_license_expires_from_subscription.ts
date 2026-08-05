/**
 * Alinha master_licenses.expires_at → master_subscriptions.expires_at (planos pagos).
 *
 * Uso:
 *   npx tsx scripts/sync_license_expires_from_subscription.ts
 *   npx tsx scripts/sync_license_expires_from_subscription.ts --apply
 *
 * Sem --apply: dry-run (mostra antes/depois).
 * Não altera TRIAL/FREE nem licenças sem assinatura corrente.
 */
import '../src/loadEnv.js';
import { pool } from '../src/db/index.js';

type Row = {
  license_id: string;
  tenant_id: string;
  plan: string | null;
  license_status: string | null;
  license_expires_at: string | null;
  subscription_id: string;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  company_name: string | null;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const result = await pool.queryMaster<Row>(
    `SELECT
        l.id::text AS license_id,
        l.tenant_id::text AS tenant_id,
        l.plan,
        l.status AS license_status,
        l.expires_at::text AS license_expires_at,
        s.id::text AS subscription_id,
        s.status AS subscription_status,
        s.expires_at::text AS subscription_expires_at,
        t.company_name
       FROM public.master_licenses l
       JOIN public.master_subscriptions s
         ON s.tenant_id = l.tenant_id
        AND s.status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','PENDING_PAYMENT')
       JOIN public.master_tenants t ON t.id = l.tenant_id
      WHERE upper(coalesce(l.plan, '')) NOT IN ('TRIAL', 'FREE')
        AND s.expires_at IS NOT NULL
        AND (
          l.expires_at IS DISTINCT FROM s.expires_at
        )
      ORDER BY t.company_name, l.id`,
  );

  const rows = result.rows;
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY_RUN',
        mismatched: rows.length,
        samples: rows.slice(0, 50).map((r) => ({
          company: r.company_name,
          tenantId: r.tenant_id,
          licenseId: r.license_id,
          plan: r.plan,
          before: r.license_expires_at,
          after: r.subscription_expires_at,
          subscriptionId: r.subscription_id,
          subscriptionStatus: r.subscription_status,
        })),
      },
      null,
      2,
    ),
  );

  if (!rows.length) {
    console.log('Nenhuma licença paga desalinhada.');
    await pool.end();
    return;
  }

  if (!apply) {
    console.log('Dry-run OK. Rode com --apply para atualizar master_licenses.expires_at.');
    await pool.end();
    return;
  }

  let updated = 0;
  for (const row of rows) {
    const res = await pool.queryMaster(
      `UPDATE public.master_licenses
          SET expires_at = $2::timestamptz,
              updated_at = now()
        WHERE id = $1
          AND expires_at IS DISTINCT FROM $2::timestamptz
        RETURNING id::text AS id`,
      [row.license_id, row.subscription_expires_at],
    );
    if (res.rows[0]) updated += 1;
  }
  console.log(JSON.stringify({ updated, totalCandidates: rows.length }, null, 2));
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
