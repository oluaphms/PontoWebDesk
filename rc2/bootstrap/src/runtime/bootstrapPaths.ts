import {
  InstallationContext,
  pathsFromInstallationContext,
  type InstallationContextOptions,
  type ResolvedRuntimePaths,
} from '@pontowebdesk/api-runtime';

export type BootstrapPaths = ResolvedRuntimePaths & {
  /** Alias histórico — igual a installRoot */
  programFilesRoot: string;
};

export function toBootstrapPaths(resolved: ResolvedRuntimePaths): BootstrapPaths {
  return { ...resolved, programFilesRoot: resolved.installRoot };
}

export type { InstallationContext, InstallationContextOptions, ResolvedRuntimePaths };

export function loadInstallationContext(options: InstallationContextOptions = {}) {
  return InstallationContext.load(options);
}

export { pathsFromInstallationContext };
