import { observabilityConsole } from '../services/observabilityConsole.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const name = process.argv[2];
if (!name) {
  observabilityConsole.error('Uso: node scripts/generate-context.mjs <context-name>');
  process.exit(1);
}

const ctx = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
const base = path.join(ROOT, 'src', 'domain', ctx);
const testBase = path.join(ROOT, 'src', 'testing', 'chaos');

function writeIfMissing(file, content) {
  if (!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, content);
}

writeIfMissing(path.join(base, 'index.ts'), `export * from './${ctx}.service';\n`);
writeIfMissing(
  path.join(base, `${ctx}.service.ts`),
  `import { operationalLog } from '../operational/observability';\n\nexport async function ${ctx}ServiceHealthcheck(): Promise<boolean> {\n  operationalLog('HEALTH', { source: '${ctx}.service', event_type: '${ctx}_healthcheck' });\n  return true;\n}\n`,
);
writeIfMissing(
  path.join(base, `${ctx}.test.ts`),
  `import { describe, expect, it } from 'vitest';\nimport { ${ctx}ServiceHealthcheck } from './${ctx}.service';\n\ndescribe('${ctx} context', () => {\n  it('healthcheck ok', async () => {\n    await expect(${ctx}ServiceHealthcheck()).resolves.toBe(true);\n  });\n});\n`,
);
writeIfMissing(
  path.join(ROOT, 'src', 'contracts', `${ctx}.contract.ts`),
  `import { z } from 'zod';\n\nexport const ${ctx.replace(/(^|-)(\w)/g, (_, a, b) => b.toUpperCase())}ContractV1 = z.object({\n  version: z.literal('v1'),\n  company_id: z.string().min(1),\n  correlation_id: z.string().nullable(),\n  operation_id: z.string().nullable(),\n  payload: z.record(z.unknown()).default({}),\n});\n`,
);
writeIfMissing(
  path.join(testBase, `${ctx}.chaos.template.test.ts`),
  `import { describe, it, expect } from 'vitest';\n\ndescribe('${ctx} chaos template', () => {\n  it('simula falha controlada', () => {\n    expect(true).toBe(true);\n  });\n});\n`,
);
writeIfMissing(
  path.join(ROOT, 'docs', `${ctx.toUpperCase()}_CONTEXT.md`),
  `# ${ctx.toUpperCase()} CONTEXT\n\n- ownership: definir time responsável\n- boundaries: documentar imports permitidos\n- contratos: referenciar src/contracts/${ctx}.contract.ts\n- tracing/metrics/watchdog: obrigatório\n`,
);

observabilityConsole.info(`[SCAFFOLD] context generated: ${ctx}`);
