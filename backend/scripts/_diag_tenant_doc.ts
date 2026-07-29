import '../src/loadEnv.js';
import { pool } from '../src/db/index.js';

async function main(): Promise<void> {
  const r = await pool.queryMaster<Record<string, unknown>>(
    `select id, company_name, company_document, operational_company_id::text as operational_company_id
       from public.master_tenants
      where id = $1
         or operational_company_id::text = $2`,
    ['tn_a871a91fb8914670', 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'],
  );
  console.log(JSON.stringify(r.rows, null, 2));
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
