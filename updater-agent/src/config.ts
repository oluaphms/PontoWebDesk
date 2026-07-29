import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type UpdaterConfig = {
  /** Base URL do Control Plane, ex.: https://master.example.com */
  controlPlaneUrl: string;
  /** Token uag_* emitido pelo Master para esta instalação. */
  agentToken: string;
  /** Canal de release. */
  channel: 'stable' | 'beta';
  /** Versão local atual do componente (lida de version.txt se não informada). */
  currentVersion: string;
  /** Diretório de instalação (binários + config). */
  installDir: string;
  /** Diretório de staging/download. */
  stagingDir: string;
  /** Diretório de backups. */
  backupDir: string;
  /** URL de health readiness local (padrão /api/health/ready). */
  healthUrl: string;
  /** Nome(s) dos serviços Windows a reiniciar, separados por vírgula. */
  serviceNames: string[];
  /** Intervalo do loop (ms). */
  pollIntervalMs: number;
  /** Timeout do health pós-restart (ms). */
  healthTimeoutMs: number;
  /** Intervalo entre polls de health (ms). */
  healthPollMs: number;
  /** Componentes extras do fingerprint (ex.: serial). */
  fingerprintComponents: string[];
  /** Caminho do arquivo de versão. */
  versionFile: string;
  /** Log file opcional. */
  logFile: string | null;
  /** Agent version (próprio updater). */
  agentVersion: string;
};

function env(name: string, fallback = ''): string {
  return String(process.env[name] ?? fallback).trim();
}

function envInt(name: string, fallback: number): number {
  const raw = Number(env(name));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function readVersionFile(path: string): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').trim().split(/\r?\n/)[0] ?? '';
}

export function loadConfig(cwd = process.cwd()): UpdaterConfig {
  loadDotEnv(resolve(cwd, '.env'));
  loadDotEnv(resolve(cwd, 'updater.env'));

  const installDir = resolve(env('PWD_INSTALL_DIR', cwd));
  const versionFile = resolve(env('PWD_VERSION_FILE', resolve(installDir, 'version.txt')));
  const currentVersion =
    env('PWD_CURRENT_VERSION') || readVersionFile(versionFile) || '0.0.0';

  const controlPlaneUrl = env('PWD_CONTROL_PLANE_URL').replace(/\/+$/, '');
  const agentToken = env('PWD_AGENT_TOKEN');
  if (!controlPlaneUrl) {
    throw new Error('PWD_CONTROL_PLANE_URL é obrigatório.');
  }
  if (!agentToken.startsWith('uag_')) {
    throw new Error('PWD_AGENT_TOKEN inválido (esperado prefixo uag_).');
  }

  const channel = (env('PWD_CHANNEL', 'stable') || 'stable') as 'stable' | 'beta';
  if (channel !== 'stable' && channel !== 'beta') {
    throw new Error('PWD_CHANNEL deve ser stable ou beta.');
  }

  return {
    controlPlaneUrl,
    agentToken,
    channel,
    currentVersion,
    installDir,
    stagingDir: resolve(env('PWD_STAGING_DIR', resolve(installDir, '.updater', 'staging'))),
    backupDir: resolve(env('PWD_BACKUP_DIR', resolve(installDir, '.updater', 'backups'))),
    healthUrl: env('PWD_HEALTH_URL', 'http://127.0.0.1:3001/api/health/ready'),
    serviceNames: env('PWD_SERVICE_NAMES', 'PontoWebDesk')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    pollIntervalMs: envInt('PWD_POLL_INTERVAL_MS', 60_000),
    healthTimeoutMs: envInt('PWD_HEALTH_TIMEOUT_MS', 120_000),
    healthPollMs: envInt('PWD_HEALTH_POLL_MS', 3_000),
    fingerprintComponents: env('PWD_FINGERPRINT_COMPONENTS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    versionFile,
    logFile: env('PWD_LOG_FILE') || null,
    agentVersion: env('PWD_AGENT_VERSION', '1.0.0') || '1.0.0',
  };
}
