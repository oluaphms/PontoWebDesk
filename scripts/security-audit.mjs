import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => /\.(ts|tsx|js|mjs|cjs|sql|yml|yaml|json|env|example)$/.test(file))
  .filter((file) => !/(^docs\/|^dist\/|node_modules|\.test\.|\.spec\.|^coverage\/)/.test(file))
  // Arquivos removidos no working tree (ainda listados pelo índice) não devem quebrar o audit.
  .filter((file) => existsSync(file));

const checks = [
  {
    name: 'VITE_*SECRET não pode ser usado',
    pattern: /\bVITE_[A-Z0-9_]*SECRET\b/,
  },
  {
    name: 'JWT/token não pode voltar para localStorage/sessionStorage',
    pattern: /\b(localStorage|sessionStorage)\.(setItem|getItem)\([^)]*(token|jwt|access_token|refresh_token)/i,
  },
  {
    name: 'console.* fora de testes é proibido',
    pattern: /\bconsole\.(log|debug|info|warn|error)\s*\(/,
  },
  {
    name: 'catch silencioso é proibido',
    pattern: /catch\s*\{\s*(?:\/\*\s*ignore\s*\*\/)?\s*\}/,
  },
  {
    name: 'segredo hardcoded suspeito',
    pattern: /\b(JWT_SECRET|API_KEY|PASSWORD|TOKEN|PRIVATE_KEY|CLIENT_SECRET)\b\s*[:=]\s*['"][^'"]{16,}['"]/,
    allowPlaceholder: true,
  },
];

const violations = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const check of checks) {
    if (check.pattern.test(text) && !(check.allowPlaceholder && /CHANGE_ME|PLACEHOLDER|GENERATE_|generate_/i.test(text))) {
      violations.push(`${file}: ${check.name}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write('Security audit failed:\n');
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exit(1);
}

process.stdout.write('Security audit passed.\n');
