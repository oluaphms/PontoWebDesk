import os from 'node:os';
import fs from 'node:fs';
import type { BootstrapPaths, PrecheckResult } from './types.js';
import type { Logger } from './Logger.js';
import { PostgresDiscovery } from './postgres/PostgresDiscovery.js';

export interface PrecheckOptions {
  requirePostgresBinaries?: boolean;
}

/**
 * Validações estruturais de ambiente (precheck).
 */
export class Validation {
  constructor(
    private readonly paths: BootstrapPaths,
    private readonly log: Logger,
    private readonly pgBinOverride?: string,
  ) {}

  validatePathsConfigured(): PrecheckResult {
    const errors: PrecheckResult['errors'] = [];
    for (const [key, value] of Object.entries(this.paths)) {
      if (!value || typeof value !== 'string') {
        errors.push({ code: 'PATH_MISSING', message: `Bootstrap path missing: ${key}` });
      }
    }
    const ok = errors.length === 0;
    this.log.info('validatePathsConfigured', { ok, errorCount: errors.length });
    return { ok, errors };
  }

  validatePlatform(): PrecheckResult {
    const errors: PrecheckResult['errors'] = [];
    if (os.platform() !== 'win32') {
      errors.push({ code: 'PLATFORM_NOT_WIN32', message: 'Bootstrap RC2 target platform is win32' });
    }
    if (os.arch() !== 'x64') {
      errors.push({ code: 'PLATFORM_NOT_X64', message: 'Bootstrap RC2 requires x64' });
    }
    const ok = errors.length === 0;
    this.log.info('validatePlatform', { ok, platform: os.platform(), arch: os.arch() });
    return { ok, errors };
  }

  validatePostgresRedist(): PrecheckResult {
    const discovery = new PostgresDiscovery(this.paths, this.pgBinOverride);
    const result = discovery.discover();
    if (result.ok) return { ok: true, errors: [] };
    return {
      ok: false,
      errors: result.errors.map((message) => ({ code: 'PG_BINARY_MISSING', message })),
    };
  }

  validateInstalledMigrate(): PrecheckResult {
    const migrateScript = this.paths.migrateScriptPath;
    const migrationsDir = this.paths.migrationsDir;
    const errors: PrecheckResult['errors'] = [];
    if (!fs.existsSync(migrateScript)) {
      errors.push({ code: 'MIGRATE_SCRIPT_MISSING', message: migrateScript });
    }
    if (!fs.existsSync(migrationsDir)) {
      errors.push({ code: 'MIGRATIONS_DIR_MISSING', message: migrationsDir });
    }
    const ok = errors.length === 0;
    this.log.info('validateInstalledMigrate', { ok, migrateScript, migrationsDir });
    return { ok, errors };
  }

  validateLayoutManifest(): PrecheckResult {
    const file = this.paths.layoutManifestFile;
    if (!fs.existsSync(file)) {
      return {
        ok: false,
        errors: [{ code: 'LAYOUT_MANIFEST_MISSING', message: file }],
      };
    }
    return { ok: true, errors: [] };
  }

  runPrecheck(options: PrecheckOptions = {}): PrecheckResult {
    const parts = [
      this.validatePathsConfigured(),
      this.validatePlatform(),
      this.validateLayoutManifest(),
    ];
    if (options.requirePostgresBinaries) {
      parts.push(this.validatePostgresRedist(), this.validateInstalledMigrate());
    }
    const errors = parts.flatMap((p) => p.errors);
    const ok = errors.length === 0;
    this.log.info('runPrecheck', { ok, embedded: options.requirePostgresBinaries });
    return { ok, errors };
  }
}
