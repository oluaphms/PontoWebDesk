import type { BootstrapPaths } from '../types.js';
import type { BackendInstallPort } from './BackendInstallPort.js';

export async function loadBackendInstallPort(
  paths: BootstrapPaths,
): Promise<BackendInstallPort | undefined> {
  if (process.env['RC2_BOOTSTRAP_API_SERVICE'] === '0') {
    return undefined;
  }
  if (process.platform !== 'win32') {
    return undefined;
  }
  try {
    const mod = await import('@pontowebdesk/api-service');
    return mod.createBootstrapBackendInstall(paths);
  } catch {
    return undefined;
  }
}
