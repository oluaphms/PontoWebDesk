import type { ApiRuntimePaths } from './types.js';
import { pathsFromInstallationContext } from './installLayout/index.js';

/**
 * Paths da API derivados do layout.manifest.json (RC2.4.1+).
 * Overrides parciais exigem programFilesRoot/programDataRoot coerentes com manifest.
 */
export function defaultApiRuntimePaths(overrides: Partial<ApiRuntimePaths> = {}): ApiRuntimePaths {
  const hasRoots = overrides.programFilesRoot != null || overrides.programDataRoot != null;
  const fromLayout = pathsFromInstallationContext({
    programFilesRoot: overrides.programFilesRoot,
    programDataRoot: overrides.programDataRoot,
  });

  const base: ApiRuntimePaths = {
    programFilesRoot: fromLayout.programFilesRoot,
    programDataRoot: fromLayout.programDataRoot,
    backendRoot: fromLayout.backendRoot,
    backendEntry: fromLayout.backendEntry,
    nodeExecutable: fromLayout.nodeExecutable,
    backendEnvFile: fromLayout.backendEnvFile,
    configDir: fromLayout.configDir,
    storageDir: fromLayout.storageDir,
    logsDir: fromLayout.logsDir,
    apiRuntimeLogFile: fromLayout.apiRuntimeLogFile,
  };

  if (!hasRoots) {
    return { ...base, ...overrides };
  }
  return { ...base, ...overrides };
}

export function backendJsPath(paths: ApiRuntimePaths): string {
  return paths.backendEntry;
}
