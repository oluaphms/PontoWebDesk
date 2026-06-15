#!/usr/bin/env node
/**
 * Re-assina config.json após edição manual ou scripts PowerShell.
 * Uso: node scripts/rep-agent-refresh-integrity.mjs [caminho/config.json]
 */
import { readFileSync, existsSync } from 'node:fs';
import { CONFIG_FILE } from './rep-agent-paths.mjs';
import { resolveSecretField } from './rep-agent-secrets.mjs';
import { signFileIntegrity } from './rep-agent-security.mjs';

const configPath = process.argv[2] || CONFIG_FILE;
if (!existsSync(configPath)) {
  console.error(`[integrity] FALHA: não encontrado: ${configPath}`);
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.error(`[integrity] FALHA: JSON inválido: ${e?.message || e}`);
  process.exit(1);
}

let apiKey;
try {
  apiKey = resolveSecretField(cfg, 'api_key', { packaged: true });
} catch (e) {
  console.error(`[integrity] FALHA: api_key_dpapi: ${e?.message || e}`);
  process.exit(1);
}
if (!apiKey) {
  console.error('[integrity] FALHA: api_key ausente — rode migrate-rep-agent-secrets-dpapi.ps1');
  process.exit(1);
}

signFileIntegrity(configPath, apiKey);
console.log(`[integrity] OK — ${configPath} e config.json.integrity atualizados`);
