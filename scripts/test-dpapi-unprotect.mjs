import { readFileSync } from 'node:fs';
import { dpapiUnprotect } from './rep-agent-secrets.mjs';

const configPath = process.argv[2] || 'C:\\ProgramData\\PontoWebDesk\\config.json';
const cfg = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const key = dpapiUnprotect(cfg.api_key_dpapi);
console.log(key ? `DPAPI OK (key length ${key.length})` : 'DPAPI FAIL');
