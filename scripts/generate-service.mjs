import { observabilityConsole } from '../services/observabilityConsole.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const name = process.argv[2];
if (!name) {
  observabilityConsole.error('Uso: node scripts/generate-service.mjs <service-name>');
  process.exit(1);
}

const safe = name.replace(/[^a-zA-Z0-9]/g, '');
const file = path.join(ROOT, 'src', 'services', `${name}.ts`);
if (fs.existsSync(file)) {
  observabilityConsole.error(`[SCAFFOLD] service já existe: src/services/${name}.ts`);
  process.exit(1);
}

fs.writeFileSync(
  file,
  `import { beginOperationalTrace, finalizeOperationalTrace, failOperationalTrace } from '../domain/operational/tracing';\nimport { recordOperationalMetric } from '../domain/operational/metrics';\n\nexport async function ${safe}Service(): Promise<void> {\n  const trace = beginOperationalTrace({ source: '${name}', company_id: null, employee_id: null });\n  const t0 = Date.now();\n  try {\n    recordOperationalMetric('rpc_latency_ms', Date.now() - t0, { source: '${name}', operation_type: '${name}' });\n    finalizeOperationalTrace(trace.trace_id);\n  } catch (error) {\n    failOperationalTrace(trace.trace_id, error);\n    throw error;\n  }\n}\n`,
);

observabilityConsole.info(`[SCAFFOLD] service generated: src/services/${name}.ts`);
