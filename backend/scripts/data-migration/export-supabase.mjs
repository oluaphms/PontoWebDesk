/**
 * Wrapper cross-platform para export-supabase.ps1 / .sh
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
const script = isWin
  ? path.join(__dirname, 'export-supabase.ps1')
  : path.join(__dirname, 'export-supabase.sh');

const r = isWin
  ? spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'inherit' })
  : spawnSync('bash', [script], { stdio: 'inherit' });

process.exit(r.status ?? 1);
