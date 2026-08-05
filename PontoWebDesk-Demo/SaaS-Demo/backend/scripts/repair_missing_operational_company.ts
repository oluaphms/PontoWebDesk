/**
 * Reparo controlado: recria public.companies faltante via writer canônico.
 * Uso: npx tsx scripts/repair_missing_operational_company.ts <tenantId>
 */
import '../src/loadEnv.js';
import { MasterCompanyProvisioningService } from '../src/master/provisioning/MasterCompanyProvisioningService.js';
import { readCompanySessionGate } from '../src/master/commercial/companySessionRevocation.js';
import { pool } from '../src/db/index.js';

async function main() {
  const tenantId = String(process.argv[2] || 'tn_a871a91fb8914670').trim();
  console.log('### REPAIR_START ###', tenantId);

  const result = await MasterCompanyProvisioningService.repairMissingOperationalCompany(tenantId, {
    email: 'system:integrity-repair',
    role: 'master',
  });
  console.log('### REPAIR_RESULT ###', result);

  const company = await pool.queryTrustedBootstrap(
    `select id::text, nome, name, cnpj, plan, commercial_blocked, license_status,
            company_session_version
       from public.companies
      where id::text = $1`,
    [result.operationalCompanyId],
  );
  console.log('### COMPANY_ROW ###', company.rows[0] ?? null);

  const gate = await readCompanySessionGate(result.operationalCompanyId);
  console.log('### GATE_AFTER_REPAIR ###', gate);

  const license = await pool.queryMaster(
    `select id::text, status, starts_at::text, expires_at::text
       from public.master_licenses where tenant_id = $1 limit 1`,
    [tenantId],
  );
  const sub = await pool.queryMaster(
    `select id::text, status from public.master_subscriptions where tenant_id = $1 limit 1`,
    [tenantId],
  );
  const tenant = await pool.queryMaster(
    `select id::text, company_name, operational_company_id::text, status
       from public.master_tenants where id = $1`,
    [tenantId],
  );
  console.log('### PRESERVED ###', {
    tenant: tenant.rows[0],
    license: license.rows[0],
    subscription: sub.rows[0],
  });

  await pool.end();
}

main().catch(async (e) => {
  console.error('### REPAIR_FAILED ###', e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
