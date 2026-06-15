#!/usr/bin/env node
/** Lê config.json e imprime JSON com api_key resolvida (DPAPI). */
import { readFileSync, existsSync } from 'node:fs';
import { resolveSecretField } from './rep-agent-secrets.mjs';

const configPath = process.argv[2] || 'C:\\ProgramData\\PontoWebDesk\\config.json';
if (!existsSync(configPath)) {
  console.error(JSON.stringify({ error: `config não encontrado: ${configPath}` }));
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const apiKey = resolveSecretField(cfg, 'api_key', { packaged: true });
console.log(
  JSON.stringify({
    saas_url: String(cfg.saas_url || '').trim(),
    device_id: String(cfg.device_id || '').trim(),
    company_id: String(cfg.company_id || '').trim(),
    device_ip: String(cfg.device_ip || '').trim(),
    enable_commands: cfg.enable_commands,
    api_key: apiKey,
  }),
);
