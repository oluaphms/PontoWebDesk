import { observabilityConsole } from '../services/observabilityConsole.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const CONFIG_PATH = path.join(ROOT, 'self-healing.config.json');
const CONFIG = fs.existsSync(CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  : { ignoreRpcTracing: [], migrationDocMode: 'warn' };

function listFiles(dir, re) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, re));
    else if (re.test(e.name)) out.push(full);
  }
  return out;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const issues = [];
const suggestions = [];
const warnings = [];
const changedSet = new Set(
  safeExec('git diff --name-only HEAD')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((v) => v.replaceAll('\\', '/').toLowerCase()),
);

const contractFiles = listFiles(path.join(SRC, 'contracts'), /\.contract\.ts$/);
if (!contractFiles.length) {
  issues.push('Nenhum contrato encontrado em src/contracts.');
  suggestions.push('Execute: npm run scaffold:contract -- sample-event');
}

const serviceFiles = listFiles(path.join(SRC, 'services'), /\.(ts|tsx)$/);
for (const file of serviceFiles) {
  const c = read(file);
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  const shouldCheck = changedSet.size === 0 || changedSet.has(rel.toLowerCase());
  const ignored = (CONFIG.ignoreRpcTracing ?? []).some((x) => rel.endsWith(String(x)));
  if (shouldCheck && !ignored && c.includes('supabase.rpc(') && !c.includes('beginOperationalTrace')) {
    issues.push(`RPC sem tracing: ${rel}`);
    suggestions.push(`Adicionar beginOperationalTrace/finalizeOperationalTrace em ${path.relative(ROOT, file)}`);
  }
}

const opFolders = listFiles(path.join(SRC, 'domain', 'operational'), /\.ts$/);
if (!opFolders.some((f) => f.includes('watchdog'))) {
  issues.push('Contexto operacional sem watchdog detectável.');
  suggestions.push('Garantir módulo em src/domain/operational/watchdog/');
}

const migrations = listFiles(path.join(ROOT, 'supabase', 'migrations'), /\.sql$/);
const migrationDocs = new Set(listFiles(path.join(ROOT, 'docs'), /\.md$/).map((f) => path.basename(f).toLowerCase()));
for (const m of migrations) {
  const base = path.basename(m, '.sql').toLowerCase();
  const hasDoc = Array.from(migrationDocs).some((d) => d.includes(base.slice(0, 8)));
  if (!hasDoc) {
    const msg = `Migration sem documentação rastreável: ${path.relative(ROOT, m)}`;
    if (String(CONFIG.migrationDocMode ?? 'warn') === 'error') issues.push(msg);
    else warnings.push(msg);
    suggestions.push(`Criar doc em docs/ explicando ${path.basename(m)}`);
  }
}

for (const w of warnings.slice(0, 20)) observabilityConsole.warn(`[SELF-HEALING CI][warn] ${w}`);
if (warnings.length > 20) observabilityConsole.warn(`[SELF-HEALING CI][warn] +${warnings.length - 20} warnings adicionais`);

if (issues.length) {
  observabilityConsole.error('[SELF-HEALING CI] issues detected');
  for (const i of issues) observabilityConsole.error(`- ${i}`);
  observabilityConsole.error('[SELF-HEALING CI] suggestions');
  for (const s of suggestions) observabilityConsole.error(`- ${s}`);
  process.exit(1);
}

observabilityConsole.info('[SELF-HEALING CI] ok');
