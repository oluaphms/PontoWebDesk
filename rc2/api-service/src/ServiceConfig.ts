import path from 'node:path';
import { pathsFromInstallationContext, type ResolvedRuntimePaths } from '@pontowebdesk/api-runtime';
import { API_RUNTIME_SERVICE_NAME } from '@pontowebdesk/api-runtime';

export const SERVICE_NAME = API_RUNTIME_SERVICE_NAME;

export const SERVICE_DISPLAY_NAME = 'PontoWebDesk API';

export const SERVICE_DESCRIPTION = 'API local do sistema PontoWebDesk.';

export const SERVICE_START_TYPE = 'auto' as const;

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

export function buildServiceBinPath(paths: ApiServicePaths): string {
  const node = paths.nodeExecutable.includes(' ') ? `"${paths.nodeExecutable}"` : paths.nodeExecutable;
  const host = paths.serviceHostScript.includes(' ') ? `"${paths.serviceHostScript}"` : paths.serviceHostScript;
  return `${node} ${host}`;
}
