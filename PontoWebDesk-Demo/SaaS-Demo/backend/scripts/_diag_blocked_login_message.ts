import '../src/loadEnv.js';
import { authenticateLogin } from '../src/services/authLoginService.js';
import { pool } from '../src/db/index.js';
import { readCompanySessionGate } from '../src/master/commercial/companySessionRevocation.js';

const companyId = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b';

async function main(): Promise<void> {
  const gate = await readCompanySessionGate(companyId);
  console.log('GATE', JSON.stringify(gate, null, 2));

  const login = await authenticateLogin({
    identifier: 'admin@pontowebdesk.com',
    password: 'wrong-password-on-purpose',
  });
  console.log('LOGIN', JSON.stringify(login, null, 2));

  const lic = await pool.queryMaster(
    `select id, tenant_id, status from public.master_licenses where id = $1`,
    ['lic_07a6ea0ee691'],
  );
  console.log('LICENSE_AFTER', JSON.stringify(lic.rows[0] ?? null, null, 2));

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
