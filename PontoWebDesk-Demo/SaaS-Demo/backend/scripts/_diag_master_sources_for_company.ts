import '../src/loadEnv.js';
import { MasterPlatformService } from '../src/services/master/masterPlatformService.js';
import { pool } from '../src/db/index.js';

const companyId = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';

async function main(): Promise<void> {
  const tenants = await MasterPlatformService.getTenantsService().list();
  const tenant =
    tenants.find((t) => String(t.operationalCompanyId || '').trim() === companyId) ||
    tenants.find((t) => t.id === companyId) ||
    null;
  console.log(
    JSON.stringify(
      {
        tenantFound: Boolean(tenant),
        tenant: tenant
          ? {
              id: tenant.id,
              status: tenant.status,
              plan: tenant.plan,
              mode: tenant.mode,
              operationalCompanyId: tenant.operationalCompanyId,
            }
          : null,
      },
      null,
      2,
    ),
  );
  if (!tenant) {
    await pool.end();
    return;
  }

  const license = await MasterPlatformService.getLicenseManager()
    .getByTenantId(tenant.id)
    .catch((e) => ({ error: String(e) }));
  const subscription = await MasterPlatformService.getLifecycle()
    .findCurrentByTenant(tenant.id)
    .catch((e) => ({ error: String(e) }));

  console.log(JSON.stringify({ license, subscription }, null, 2));
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
