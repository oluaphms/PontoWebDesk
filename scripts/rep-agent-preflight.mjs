#!/usr/bin/env node
/**
 * Valida config.json como o rep-agent.exe empacotado (DPAPI obrigatório).
 * Uso: node scripts/rep-agent-preflight.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { CONFIG_FILE } from './rep-agent-paths.mjs';
import { resolveSecretField } from './rep-agent-secrets.mjs';

const configPath = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : CONFIG_FILE;

if (!existsSync(configPath)) {
  console.error(`[preflight] FALHA: config não encontrado: ${configPath}`);
  process.exit(1);
}

let cfg;
try {
  const raw = readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  cfg = JSON.parse(raw);
} catch (e) {
  console.error(`[preflight] FALHA: JSON inválido: ${e?.message || e}`);
  process.exit(1);
}

const errors = [];
for (const field of ['saas_url', 'device_id', 'device_ip']) {
  if (!String(cfg[field] ?? '').trim()) {
    errors.push(`campo obrigatório ausente: ${field}`);
  }
}

try {
  const apiKey = resolveSecretField(cfg, 'api_key', { packaged: true });
  if (!apiKey) errors.push('api_key (ou api_key_dpapi) ausente');
  resolveSecretField(cfg, 'device_password', { packaged: true });
} catch (e) {
  errors.push(e?.message || String(e));
}

if (errors.length) {
  console.error('[preflight] FALHA — o rep-agent.exe não iniciará:');
  for (const err of errors) console.error(`  - ${err}`);
  console.error('');
  console.error('Correção (Admin):');
  console.error('  powershell -ExecutionPolicy Bypass -File scripts\\migrate-rep-agent-secrets-dpapi.ps1');
  console.error('  powershell -ExecutionPolicy Bypass -File scripts\\fix-rep-agent-offline.ps1');
  process.exit(1);
}

console.log('[preflight] OK — config compatível com rep-agent.exe empacotado');
console.log(`  saas_url=${String(cfg.saas_url).trim()}`);
console.log(`  device_id=${String(cfg.device_id).trim()}`);
console.log(`  device_ip=${String(cfg.device_ip).trim()}`);
console.log(`  api_key_dpapi=${cfg.api_key_dpapi ? 'presente' : 'ausente'}`);
