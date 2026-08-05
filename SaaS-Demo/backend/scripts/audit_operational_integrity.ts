/**
 * Auditoria de integridade Master ↔ operacional (somente leitura).
 * Uso: npx tsx scripts/audit_operational_integrity.ts
 * Exit 1 se houver inconsistências críticas/high (tenant/user/license/subscription).
 */
import '../src/loadEnv.js';
import { pool } from '../src/db/index.js';
import {
  formatOperationalIntegrityReport,
  runOperationalIntegrityAudit,
} from '../src/master/integrity/operationalIntegrity.js';

async function main() {
  const report = await runOperationalIntegrityAudit();
  console.log(formatOperationalIntegrityReport(report));
  console.log('\n=== JSON ===');
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
  if (!report.ok) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
