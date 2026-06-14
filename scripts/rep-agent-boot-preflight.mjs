import { readFileSync, existsSync } from 'node:fs';
import { CONFIG_FILE } from './rep-agent-paths.mjs';
import { resolveSecretField } from './rep-agent-secrets.mjs';
import { validateProgramDataPermissions } from './rep-agent-security.mjs';

const configPath = process.argv[2] || CONFIG_FILE;
if (!existsSync(configPath)) {
  console.error('config nao encontrado');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const apiKey = resolveSecretField(cfg, 'api_key', { packaged: true });
console.log(apiKey ? `api_key OK (${apiKey.length} chars)` : 'api_key FAIL');
const acl = validateProgramDataPermissions();
console.log(acl.ok ? 'ACL OK' : `ACL FAIL: ${acl.message}`);
process.exit(apiKey && acl.ok ? 0 : 1);
