import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONTRACTS = path.join(ROOT, 'src', 'contracts');

const requiredFiles = [
  'events.contract.ts',
  'timeline.contract.ts',
  'incidents.contract.ts',
  'trace.contract.ts',
  'rpc.contract.ts',
  'geo.contract.ts',
  'replay.contract.ts',
];

if (!fs.existsSync(CONTRACTS)) {
  console.error('[CONTRACT VALIDATION] contracts folder missing');
  process.exit(1);
}

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(CONTRACTS, file)));
if (missing.length > 0) {
  console.error('[CONTRACT VALIDATION] missing files');
  for (const m of missing) console.error(`- ${m}`);
  process.exit(1);
}

const invalid = [];
for (const file of requiredFiles) {
  const content = fs.readFileSync(path.join(CONTRACTS, file), 'utf8');
  if (!content.includes('version')) invalid.push(file);
}

if (invalid.length > 0) {
  console.error('[CONTRACT VALIDATION] version field missing');
  for (const m of invalid) console.error(`- ${m}`);
  process.exit(1);
}

console.info('[CONTRACT VALIDATION] ok');
