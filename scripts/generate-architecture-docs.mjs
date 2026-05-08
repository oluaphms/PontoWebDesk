import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DOC = path.join(ROOT, 'docs', 'ARCHITECTURE_MAP.md');

function listFiles(dir, match) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, match));
    else if (match.test(e.name)) out.push(full.replaceAll('\\', '/'));
  }
  return out;
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const domainFiles = listFiles(path.join(SRC, 'domain'), /\.(ts|tsx)$/);
const contracts = listFiles(path.join(SRC, 'contracts'), /\.contract\.ts$/).map((f) => f.split('/src/')[1]);
const serviceFiles = listFiles(path.join(SRC, 'services'), /\.(ts|tsx)$/);

const rpcSet = new Set();
const timelineSet = new Set();
for (const file of [...domainFiles, ...serviceFiles]) {
  const content = read(file);
  for (const m of content.matchAll(/rpc\(\s*['"`]([^'"`]+)['"`]/g)) rpcSet.add(m[1]);
  for (const m of content.matchAll(/time_attendance_timeline|TIMELINE_APPEND|appendTimeAttendanceTimelineEvent/g)) timelineSet.add(m[0]);
}

const contexts = ['geo', 'rep', 'timesheet', 'operational', 'reliability', 'audit', 'replay', 'governance', 'observability'];
const contextLines = contexts.map((ctx) => {
  const count = domainFiles.filter((f) => f.includes(`/domain/${ctx}/`)).length;
  return `- \`${ctx.toUpperCase()}\`: ${count} arquivos`;
});

const content = `# ARCHITECTURE MAP

> Arquivo gerado automaticamente por \`npm run generate:architecture-docs\`.

## Contexts

${contextLines.join('\n')}

## Contratos

${contracts.length ? contracts.map((c) => `- \`${c}\``).join('\n') : '- Nenhum contrato encontrado'}

## RPC Map

${rpcSet.size ? Array.from(rpcSet).sort().map((r) => `- \`${r}\``).join('\n') : '- Nenhuma chamada RPC detectada'}

## Timeline Events / Integração

${timelineSet.size ? Array.from(timelineSet).sort().map((t) => `- \`${t}\``).join('\n') : '- Nenhuma integração timeline detectada'}

## Dependency Graph (high level)

\`\`\`mermaid
graph TD
  UI[Pages/Components] --> SVC[Services]
  SVC --> DOM[Domain]
  DOM --> OPS[Operational]
  DOM --> CTR[Contracts]
  OPS --> OBS[Tracing/Metrics/Watchdog]
  SVC --> RPC[Supabase RPC]
  RPC --> DB[(Supabase)]
\`\`\`
`;

fs.mkdirSync(path.dirname(DOC), { recursive: true });
fs.writeFileSync(DOC, content);
console.info('[ARCH DOCS] updated docs/ARCHITECTURE_MAP.md');
