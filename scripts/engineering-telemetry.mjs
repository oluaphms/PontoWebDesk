import { observabilityConsole } from '../services/observabilityConsole.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const outPath = path.join(ROOT, 'docs', 'ENGINEERING_TELEMETRY.md');

function safeExec(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const changed = safeExec('git log --since="30 days ago" --name-only --pretty=format:').split(/\r?\n/).filter(Boolean);
const churn = new Map();
for (const file of changed) churn.set(file, (churn.get(file) ?? 0) + 1);
const hotspots = Array.from(churn.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

const report = `# ENGINEERING TELEMETRY

> Snapshot automático (últimos 30 dias de histórico local).

## Build/Test/CI

- Tempo médio de build: coletar em CI (workflow summary)
- Tempo médio de teste: coletar em CI (workflow summary)
- Tempo médio total de CI: coletar em CI (workflow summary)

## Hotspots arquiteturais (churn)

${hotspots.length ? hotspots.map(([f, n]) => `- \`${f}\`: ${n} alterações`).join('\n') : '- Sem dados de churn suficientes'}

## Sinais de fragilidade por contexto

- Contextos mais frágeis: alta concentração de mudanças em \`src/domain/operational\`, \`src/services\` (ver hotspots).
- Churn de contratos: monitorar mudanças em \`src/contracts/*.contract.ts\`.
- Frequência de rollback: integrar métrica via eventos de deploy (fora do repositório local).
`;

fs.writeFileSync(outPath, report);
observabilityConsole.info('[ENGINEERING TELEMETRY] updated docs/ENGINEERING_TELEMETRY.md');
