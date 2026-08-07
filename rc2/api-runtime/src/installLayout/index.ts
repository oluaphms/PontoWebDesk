import path from 'node:path';
import type { InstallationContextOptions } from './InstallationContext.js';
import { InstallationContext } from './InstallationContext.js';
import { LayoutResolver, LAYOUT_MANIFEST_FILENAME } from './LayoutResolver.js';
import { RuntimePathResolver } from './RuntimePathResolver.js';
import type {
  BootstrapMode,
  LayoutComponentSpec,
  LayoutManifest,
  ResolvedRuntimePaths,
} from './layoutTypes.js';

export {
  InstallationContext,
  type InstallationContextOptions,
  LayoutResolver,
  LAYOUT_MANIFEST_FILENAME,
  RuntimePathResolver,
  type BootstrapMode,
  type LayoutComponentSpec,
  type LayoutManifest,
  type ResolvedRuntimePaths,
};

export function pathsFromInstallationContext(
  overrides: Partial<{
    programFilesRoot: string;
    programDataRoot: string;
  }> = {},
) {
  const ctx = InstallationContext.load({
    programFilesRoot: overrides.programFilesRoot,
    programDataRoot: overrides.programDataRoot,
  });
  const p = ctx.paths;
  return {
    programFilesRoot: p.installRoot,
    programDataRoot: p.programDataRoot,
    backendRoot: p.backendRoot,
    backendEntry: p.backendEntry,
    nodeExecutable: p.nodeExecutable,
    backendEnvFile: p.backendEnvFile,
    configDir: p.configDir,
    storageDir: p.storageDir,
    logsDir: p.logsDir,
    apiRuntimeLogFile: path.join(p.logsDir, 'api-runtime.log'),
    binDir: p.binDir,
    serviceHostScript: p.serviceHostScript,
  };
}
