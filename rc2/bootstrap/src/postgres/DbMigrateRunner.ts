import fs from 'node:fs';
import path from 'node:path';
import type { BootstrapPaths } from '../types.js';
import type { Logger } from '../Logger.js';
import { execFileAsync } from './exec.js';

/**
 * DbMigrate via layout instalado (RC2_MIGRATIONS_ROOT + runner em Bin).
 */
export class DbMigrateRunner {
  constructor(
    private readonly paths: BootstrapPaths,
    private readonly log: Logger,
  ) {}

  getScriptPath(): string {
    return this.paths.migrateScriptPath;
  }

  getMigrationsRoot(): string {
    return this.paths.migrationsDir;
  }

  async runSchemaBaseline(databaseUrl: string): Promise<void> {
    await this.runMigrateFull(databaseUrl);
    this.log.info('DbMigrateRunner.runSchemaBaseline delegated to migrate full (idempotent ledger)');
  }

  async runMigrateFull(databaseUrlMigrate: string): Promise<void> {
    const script = this.getScriptPath();
    if (!fs.existsSync(script)) {
      throw new Error(`DB_MIGRATE_SCRIPT_MISSING: ${script}`);
    }
    if (!fs.existsSync(this.getMigrationsRoot())) {
      throw new Error(`MIGRATIONS_DIR_MISSING: ${this.getMigrationsRoot()}`);
    }
    const nodeModules = path.join(this.paths.backendRoot, 'server', 'node_modules');
    const r = await execFileAsync(this.paths.nodeExecutable, [script], {
      cwd: path.dirname(script),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrlMigrate,
        DATABASE_SSL: 'false',
        RC2_MIGRATIONS_ROOT: this.getMigrationsRoot(),
        NODE_PATH: nodeModules,
      },
      timeoutMs: 600_000,
    });
    if (r.exitCode !== 0) {
      throw new Error(`DB_MIGRATE_FULL_FAILED: ${r.stderr || r.stdout}`);
    }
    this.log.info('DbMigrateRunner.runMigrateFull OK');
  }
}
