import fs from 'node:fs';
import path from 'node:path';
import { pathsFromInstallationContext, type ResolvedRuntimePaths } from '@pontowebdesk/api-runtime';
import { API_RUNTIME_SERVICE_NAME } from '@pontowebdesk/api-runtime';
import { scBinPathValue } from './scExec.js';

export const SERVICE_NAME = API_RUNTIME_SERVICE_NAME;

export const SERVICE_DISPLAY_NAME = 'PontoWebDesk API';

export const SERVICE_DESCRIPTION = 'API local do sistema PontoWebDesk.';

export const SERVICE_START_TYPE = 'auto' as const;

export const SERVICE_HOST_EXE_NAME = 'PontoWebDeskServiceHost.exe';

export const API_PORT = 3000;

export const RECOVERY_RESET_SECONDS = 86400;

export const RECOVERY_ACTIONS = [
  { delayMs: 5000, action: 'restart' as const },
  { delayMs: 30000, action: 'restart' as const },
  { delayMs: 60000, action: 'restart' as const },
];

export interface ApiServicePaths {
  programFilesRoot: string;
  programDataRoot: string;
  binDir: string;
  serviceHostScript: string;
  nodeExecutable: string;
  backendEntry: string;
  backendRoot: string;
  backendEnvFile: string;
  configDir: string;
  storageDir: string;
  logsDir: string;
  apiRuntimeLogFile: string;
}

const REQUIRED_KEYS: (keyof ApiServicePaths)[] = [
  'programFilesRoot',
  'programDataRoot',
  'binDir',
  'serviceHostScript',
  'nodeExecutable',
  'backendEntry',
  'backendRoot',
  'backendEnvFile',
  'configDir',
  'storageDir',
  'logsDir',
  'apiRuntimeLogFile',
];

function isCompleteApiServicePaths(overrides: Partial<ApiServicePaths>): overrides is ApiServicePaths {
  return REQUIRED_KEYS.every((k) => {
    const v = overrides[k];
    return typeof v === 'string' && v.length > 0;
  });
}

/** Mapeia paths resolvidos pelo Bootstrap (sem reler manifest). */
export function apiServicePathsFromResolved(resolved: ResolvedRuntimePaths): ApiServicePaths {
  return {
    programFilesRoot: resolved.installRoot,
    programDataRoot: resolved.programDataRoot,
    binDir: resolved.binDir,
    serviceHostScript: resolved.serviceHostScript,
    nodeExecutable: resolved.nodeExecutable,
    backendEntry: resolved.backendEntry,
    backendRoot: resolved.backendRoot,
    backendEnvFile: resolved.backendEnvFile,
    configDir: resolved.configDir,
    storageDir: resolved.storageDir,
    logsDir: resolved.logsDir,
    apiRuntimeLogFile: path.join(resolved.logsDir, 'api-runtime.log'),
  };
}

export function defaultApiServicePaths(overrides: Partial<ApiServicePaths> = {}): ApiServicePaths {
  if (isCompleteApiServicePaths(overrides)) {
    return overrides;
  }

  const fromLayout = pathsFromInstallationContext({
    programFilesRoot: overrides.programFilesRoot,
    programDataRoot: overrides.programDataRoot,
  });

  const base: ApiServicePaths = {
    programFilesRoot: fromLayout.programFilesRoot,
    programDataRoot: fromLayout.programDataRoot,
    binDir: fromLayout.binDir,
    serviceHostScript: fromLayout.serviceHostScript,
    nodeExecutable: fromLayout.nodeExecutable,
    backendEntry: fromLayout.backendEntry,
    backendRoot: fromLayout.backendRoot,
    backendEnvFile: fromLayout.backendEnvFile,
    configDir: fromLayout.configDir,
    storageDir: fromLayout.storageDir,
    logsDir: fromLayout.logsDir,
    apiRuntimeLogFile: fromLayout.apiRuntimeLogFile,
  };

  return { ...base, ...overrides };
}

export function serviceHostExePath(paths: Pick<ApiServicePaths, 'binDir'>): string {
  return path.join(paths.binDir, SERVICE_HOST_EXE_NAME);
}

export function apiServiceHostConfigPath(paths: Pick<ApiServicePaths, 'configDir'>): string {
  return path.join(paths.configDir, 'api-service-host.ini');
}

export function buildServiceBinPath(paths: ApiServicePaths): string {
  return scBinPathValue(serviceHostExePath(paths), apiServiceHostConfigPath(paths));
}

export function writeApiServiceHostConfig(paths: ApiServicePaths): string {
  const cfg = apiServiceHostConfigPath(paths);
  const envPath = path.join(paths.configDir, 'api-service.env');
  let envBody = '';
  if (fs.existsSync(paths.backendEnvFile)) {
    envBody = fs.readFileSync(paths.backendEnvFile, 'utf8');
    if (!envBody.endsWith('\n')) envBody += '\n';
  }
  if (!/^PORT=/m.test(envBody)) envBody += 'PORT=3000\n';
  if (!/^NODE_ENV=/m.test(envBody)) envBody += 'NODE_ENV=production\n';
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, envBody, 'utf8');

  const serverCwd = path.join(paths.backendRoot, 'server');
  const body = [
    `serviceName=${SERVICE_NAME}`,
    `executable=${paths.nodeExecutable}`,
    `argument=${paths.backendEntry}`,
    `workingDirectory=${fs.existsSync(serverCwd) ? serverCwd : paths.backendRoot}`,
    `stdoutLog=${path.join(paths.logsDir, 'api-service.out.log')}`,
    `stderrLog=${path.join(paths.logsDir, 'api-service.err.log')}`,
    `envFile=${envPath}`,
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, body, 'utf8');
  return cfg;
}
