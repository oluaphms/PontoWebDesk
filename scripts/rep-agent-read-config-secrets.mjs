#!/usr/bin/env node
/** Lê config.json e imprime JSON com segredos resolvidos (DPAPI). Uso: scripts de diagnóstico locais. */
import { readFileSync, existsSync } from 'node:fs';
import { resolveSecretField } from './rep-agent-secrets.mjs';

const configPath = process.argv[2] || 'C:\\ProgramData\\PontoWebDesk\\config.json';
if (!existsSync(configPath)) {
  console.error(JSON.stringify({ error: `config não encontrado: ${configPath}` }));
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const apiKey = resolveSecretField(cfg, 'api_key', { packaged: true });
const devicePassword = resolveSecretField(cfg, 'device_password', { packaged: true });
console.log(
  JSON.stringify({
    saas_url: String(cfg.saas_url || '').trim(),
    device_id: String(cfg.device_id || '').trim(),
    company_id: String(cfg.company_id || '').trim(),
    device_ip: String(cfg.device_ip || '').trim(),
    device_login: String(cfg.device_login || 'admin').trim() || 'admin',
    device_scheme: String(cfg.device_scheme || '').trim(),
    device_port: cfg.device_port != null ? String(cfg.device_port).trim() : '',
    enable_commands: cfg.enable_commands,
    has_device_password_dpapi: Boolean(String(cfg.device_password_dpapi || '').trim()),
    has_device_password_plain: Boolean(String(cfg.device_password || '').trim()),
    device_password: devicePassword,
    api_key: apiKey,
  }),
);
