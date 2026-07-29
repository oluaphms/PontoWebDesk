/**
 * Diagnóstico somente leitura: mesma stack de Pool/bootstrap do backend.
 * Não altera auth. Imprime os 10 fatos pedidos.
 */
import '../src/loadEnv.js';
import { getPoolDiagnostics, withTrustedBootstrapClient } from '../src/db/index.js';

async function main() {
  const poolDiag = getPoolDiagnostics();
  const evidence = await withTrustedBootstrapClient(async (client) => {
    const session = await client.query(`
      SELECT
        pg_backend_pid() AS backend_pid,
        current_database() AS current_database,
        current_user AS current_user,
        session_user AS session_user,
        current_schema() AS current_schema,
        current_setting('search_path') AS search_path,
        current_setting('data_directory') AS data_directory,
        version() AS version
    `);

    const countRes = await client.query(`SELECT COUNT(*)::text AS count FROM public.users`);
    const listRes = await client.query(`
      SELECT id::text AS id, email, status
      FROM public.users
      ORDER BY email
    `);
    const targetRes = await client.query(`
      SELECT id::text AS id, email, status, company_id::text AS company_id
      FROM public.users
      WHERE email = 'admin@pontowebdesk.com'
    `);
    const hashRes = await client.query(`
      SELECT md5(string_agg(email, ',' ORDER BY email)) AS md5
      FROM public.users
    `);

    return {
      etapa1: session.rows[0] ?? null,
      etapa2_count: Number(countRes.rows[0]?.count ?? 0),
      etapa2_emails: listRes.rows.map((r: { email: string }) => r.email),
      etapa2_rows: listRes.rows,
      etapa3_rowCount: targetRes.rowCount ?? targetRes.rows.length,
      etapa3_rows: targetRes.rows,
      etapa4_md5: (hashRes.rows[0] as { md5?: string | null } | undefined)?.md5 ?? null,
      etapa5_pool: poolDiag,
    };
  });

  console.log('### LOGIN_DB_DIVERGENCE_EVIDENCE ###');
  console.log(JSON.stringify(evidence, null, 2));
}

main()
  .then(async () => {
    const { pool } = await import('../src/db/index.js');
    await pool.end();
  })
  .catch((err) => {
    console.error('DIAG_FAILED', err);
    process.exit(1);
  });
