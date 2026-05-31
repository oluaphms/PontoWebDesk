import { observabilityConsole } from '../services/observabilityConsole.js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const CONFIG_PATH = path.join(ROOT, 'architecture-lint.config.json');

const CONTEXTS = [
  'geo',
  'rep',
  'timesheet',
  'operational',
  'reliability',
  'audit',
  'replay',
  'governance',
  'observability',
];

const DEFAULT_FORBIDDEN_CROSS = [
  { from: '/domain/operational/', to: '/services/supabaseClient', reason: 'Acesso infra direto fora ACL.' },
  { from: '/domain/geo/', to: '/domain/rep/', reason: 'Cross-context GEO -> REP sem contrato.' },
  { from: '/domain/rep/', to: '/domain/geo/', reason: 'Cross-context REP -> GEO sem contrato.' },
  { from: '/services/', to: '/pages/', reason: 'Serviços não importam páginas (fronteira UI).' },
  { from: '/domain/', to: '/pages/', reason: 'Domínio não importa páginas React.' },
  { from: '/domain/', to: '/components/', reason: 'Domínio não importa componentes de UI.' },
];

const CONFIG = fs.existsSync(CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  : { allowedCrossContext: [], forbiddenImports: DEFAULT_FORBIDDEN_CROSS, documentedExceptions: [] };
const FORBIDDEN_CROSS = CONFIG.forbiddenImports ?? DEFAULT_FORBIDDEN_CROSS;
const ALLOW = new Set((CONFIG.allowedCrossContext ?? []).map((v) => String(v).toLowerCase()));

function readDirRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readDirRecursive(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function contextFromFile(filePath) {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  const hit = CONTEXTS.find((ctx) => normalized.includes(`/domain/${ctx}/`));
  return hit ?? null;
}

function extractImports(content) {
  const regex = /from\s+['"]([^'"]+)['"]/g;
  const out = [];
  let m;
  while ((m = regex.exec(content))) out.push(m[1]);
  return out;
}

const files = readDirRecursive(SRC);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const imports = extractImports(content);
  const normalizedFile = file.replaceAll('\\', '/');
  const fromCtx = contextFromFile(normalizedFile);

  for (const imp of imports) {
    for (const rule of FORBIDDEN_CROSS) {
      if (normalizedFile.includes(rule.from) && imp.includes(rule.to)) {
        violations.push({
          type: 'forbidden-import',
          file: normalizedFile.replace(`${ROOT.replaceAll('\\', '/')}/`, ''),
          import: imp,
          reason: rule.reason,
        });
      }
    }

    if (fromCtx && imp.includes('/domain/')) {
      const otherCtx = CONTEXTS.find((ctx) => imp.toLowerCase().includes(`/domain/${ctx}/`));
      const allowKey = `${fromCtx}->${otherCtx}`;
      if (otherCtx && otherCtx !== fromCtx && !imp.includes('/contracts/') && !ALLOW.has(allowKey)) {
        violations.push({
          type: 'cross-context',
          file: normalizedFile.replace(`${ROOT.replaceAll('\\', '/')}/`, ''),
          import: imp,
          reason: `Contexto "${fromCtx}" importando "${otherCtx}" sem contrato.`,
        });
      }
    }
  }
}

if (violations.length > 0) {
  observabilityConsole.error('[ARCHITECTURE LINT] violations detected');
  observabilityConsole.error('[ARCHITECTURE LINT] quick-fix hints:');
  observabilityConsole.error('- Mover tipos compartilhados para src/contracts');
  observabilityConsole.error('- Registrar excecao temporaria em architecture-lint.config.json');
  observabilityConsole.error('- Encapsular acesso infra em service/adapter autorizado');
  for (const v of violations) {
    observabilityConsole.error(`- ${v.type}: ${v.file} -> ${v.import} (${v.reason})`);
  }
  process.exit(1);
}

observabilityConsole.info('[ARCHITECTURE LINT] ok');
