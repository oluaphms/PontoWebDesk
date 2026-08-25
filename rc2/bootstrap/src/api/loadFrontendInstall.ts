import type { BootstrapPaths } from '../types.js';
import type { FrontendInstallPort } from './FrontendInstallPort.js';

export async function loadFrontendInstallPort(
  paths: BootstrapPaths,
): Promise<FrontendInstallPort | undefined> {
  if (process.env['RC2_BOOTSTRAP_FRONTEND_SERVICE'] === '0') {
    return undefined;
  }
  if (process.platform !== 'win32') {
    return undefined;
  }
  try {
    const mod = await import('@pontowebdesk/api-service');
    return mod.createBootstrapFrontendInstall(paths);
  } catch {
    return undefined;
  }
}
