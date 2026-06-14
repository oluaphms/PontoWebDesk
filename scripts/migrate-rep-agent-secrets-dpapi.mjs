#!/usr/bin/env node
/**
 * CLI: migra segredos em config.json para campos *_dpapi.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { migrateConfigSecretsToDpapi, dpapiUnprotect } from './rep-agent-secrets.mjs';
import { signFileIntegrity } from './rep-agent-security.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  let config = 'C:\\ProgramData\\PontoWebDesk\\config.json';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--config' && args[i + 1]) {
      config = args[i + 1];
      i += 1;
    }
  }
  return { config };
}

const { config } = parseArgs();
const raw = readFileSync(config, 'utf8');
const cfg = JSON.parse(raw.replace(/^\uFEFF/, ''));
const migrated = migrateConfigSecretsToDpapi(cfg);
delete migrated.device_session;
writeFileSync(config, JSON.stringify(migrated, null, 2), 'utf8');

if (migrated.api_key_dpapi && process.platform === 'win32') {
  const key = dpapiUnprotect(migrated.api_key_dpapi);
  signFileIntegrity(config, key);
}

console.log(`[migrate] ${config} — segredos migrados para DPAPI`);
