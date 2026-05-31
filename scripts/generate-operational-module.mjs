import { observabilityConsole } from '../services/observabilityConsole.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const name = process.argv[2];
if (!name) {
  observabilityConsole.error('Uso: node scripts/generate-operational-module.mjs <module-name>');
  process.exit(1);
}

const mod = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
const base = path.join(ROOT, 'src', 'domain', 'operational', mod);
fs.mkdirSync(base, { recursive: true });

const file = path.join(base, `${mod}.ts`);
if (!fs.existsSync(file)) {
  fs.writeFileSync(
    file,
    `import { beginOperationalTrace, appendOperationalTraceSpan, finalizeOperationalTrace, failOperationalTrace } from '../tracing';\nimport { recordOperationalMetric } from '../metrics';\nimport { operationalLog } from '../observability';\n\nexport async function run${mod.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase())}Module(): Promise<void> {\n  const trace = beginOperationalTrace({ source: 'operational.${mod}', company_id: null, employee_id: null });\n  const t0 = Date.now();\n  try {\n    appendOperationalTraceSpan({ trace_id: trace.trace_id, type: 'GOVERNANCE', source: 'operational.${mod}', status: 'ok' });\n    recordOperationalMetric('replay_duration_ms', Date.now() - t0, { source: 'operational.${mod}', operation_type: '${mod}' });\n    operationalLog('EVENT', { source: 'operational.${mod}', event_type: '${mod}_executed' });\n    finalizeOperationalTrace(trace.trace_id);\n  } catch (error) {\n    failOperationalTrace(trace.trace_id, error);\n    throw error;\n  }\n}\n`,
  );
}

const idx = path.join(base, 'index.ts');
if (!fs.existsSync(idx)) fs.writeFileSync(idx, `export * from './${mod}';\n`);

observabilityConsole.info(`[SCAFFOLD] operational module generated: src/domain/operational/${mod}`);
