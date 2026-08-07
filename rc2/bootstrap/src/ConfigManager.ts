import type { BootstrapMode } from '@pontowebdesk/api-runtime';
import {
  InstallationContext,
  type InstallationContextOptions,
} from '@pontowebdesk/api-runtime';
import type { BootstrapPaths } from './runtime/bootstrapPaths.js';
import { toBootstrapPaths } from './runtime/bootstrapPaths.js';

export interface ConfigManagerOptions {
  programFilesRoot?: string;
  programDataRoot?: string;
  pgBinOverride?: string;
  bootstrapMode?: BootstrapMode;
}

/**
 * Caminhos RC2 derivados exclusivamente do layout instalado (layout.manifest.json).
 */
export class ConfigManager {
  readonly installation: InstallationContext;
  readonly paths: BootstrapPaths;

  constructor(options: ConfigManagerOptions = {}) {
    const loadOpts: InstallationContextOptions = {
      programFilesRoot: options.programFilesRoot,
      programDataRoot: options.programDataRoot,
      bootstrapMode: options.bootstrapMode,
    };
    this.installation = InstallationContext.load(loadOpts);
    this.paths = toBootstrapPaths(this.installation.paths);
  }

  getPgBinOverride(): string | undefined {
    return process.env['RC2_PG_BIN_DIR'] ?? undefined;
  }

  getPaths(): BootstrapPaths {
    return { ...this.paths };
  }
}
