import { observabilityConsole } from '../services/observabilityConsole.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const files = fs.existsSync(MIGRATIONS) ? fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')) : [];

if (files.length === 0) {
  observabilityConsole.error('[MIGRATION VALIDATION] no migration files found');
  process.exit(1);
}

const badNames = files.filter((f) => !/^(\d{14}|\d{8})_.+\.sql$/.test(f));
if (badNames.length > 0) {
  observabilityConsole.error('[MIGRATION VALIDATION] invalid file naming');
  for (const f of badNames) observabilityConsole.error(`- ${f}`);
  process.exit(1);
}

observabilityConsole.info('[MIGRATION VALIDATION] ok');
