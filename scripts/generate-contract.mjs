import { observabilityConsole } from '../services/observabilityConsole.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const name = process.argv[2];
if (!name) {
  observabilityConsole.error('Uso: node scripts/generate-contract.mjs <contract-name>');
  process.exit(1);
}

const file = path.join(ROOT, 'src', 'contracts', `${name}.contract.ts`);
if (fs.existsSync(file)) {
  observabilityConsole.error(`[SCAFFOLD] contract já existe: src/contracts/${name}.contract.ts`);
  process.exit(1);
}

const pascal = name.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
fs.writeFileSync(
  file,
  `import { z } from 'zod';\n\nexport const ${pascal}ContractV1 = z.object({\n  version: z.literal('v1'),\n  company_id: z.string().min(1),\n  correlation_id: z.string().nullable(),\n  operation_id: z.string().nullable(),\n  payload: z.record(z.unknown()).default({}),\n});\n\nexport type ${pascal}Contract = z.infer<typeof ${pascal}ContractV1>;\n`,
);

observabilityConsole.info(`[SCAFFOLD] contract generated: src/contracts/${name}.contract.ts`);
