import fs from 'node:fs';
import path from 'node:path';
import type { BootstrapPaths, PostgresConnectionConfig } from '../types.js';
import type { Logger } from '../Logger.js';
import type { DiscoveryResult } from './PostgresDiscovery.js';
import { execFileAsync } from './exec.js';

const DB_NAME = 'pontowebdesk';

/**
 * Roles e database RC2-ARCH §6.2.
 */
export class DatabaseProvisioner {
  constructor(
    private readonly paths: BootstrapPaths,
    private readonly log: Logger,
    private readonly discovery: DiscoveryResult,
  ) {}

  async provision(config: PostgresConnectionConfig): Promise<void> {
    await this.runPsqlAdmin(
      config,
      'postgres',
      `
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${config.migrateUser}') THEN
    CREATE ROLE ${config.migrateUser} LOGIN PASSWORD '${this.esc(config.migratePassword)}' CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${config.appUser}') THEN
    CREATE ROLE ${config.appUser} LOGIN PASSWORD '${this.esc(config.appPassword)}';
  END IF;
END
$$;
`,
    );

    const exists = await this.databaseExists(config);
    if (!exists) {
      await this.runPsqlAdmin(
        config,
        'postgres',
        `CREATE DATABASE ${DB_NAME} OWNER ${config.migrateUser};`,
      );
    }

    await this.runPsqlAdmin(
      { ...config, database: DB_NAME },
      config.migrateUser,
      `
GRANT CONNECT ON DATABASE ${DB_NAME} TO ${config.appUser};
ALTER DEFAULT PRIVILEGES FOR ROLE ${config.migrateUser} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${config.appUser};
`,
      config.migratePassword,
    );

    await this.writeBackendEnv(config);
    this.log.info('DatabaseProvisioner.provision OK', { database: DB_NAME });
  }

  private esc(value: string): string {
    return value.replace(/'/g, "''");
  }

  private async databaseExists(config: PostgresConnectionConfig): Promise<boolean> {
    const r = await this.runPsqlAdmin(
      config,
      'postgres',
      `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}';`,
    );
    return r.stdout.includes('1');
  }

  private async runPsqlAdmin(
    config: PostgresConnectionConfig,
    user: string,
    sql: string,
    password?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const env = {
      ...process.env,
      PGPASSWORD: password ?? config.superuserPassword,
    };
    const tmp = path.join(this.paths.configDir, 'tmp-provision.sql');
    fs.mkdirSync(this.paths.configDir, { recursive: true });
    fs.writeFileSync(tmp, sql, 'utf8');
    try {
      const r = await execFileAsync(
        this.discovery.psqlExe,
        [
          '-h',
          config.host,
          '-p',
          String(config.port),
          '-U',
          user,
          '-d',
          config.database,
          '-f',
          tmp,
          '-v',
          'ON_ERROR_STOP=1',
        ],
        { env, timeoutMs: 120_000 },
      );
      if (r.exitCode !== 0) {
        throw new Error(`PSQL_FAILED: ${r.stderr || r.stdout}`);
      }
      return r;
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
  }

  private async writeBackendEnv(config: PostgresConnectionConfig): Promise<void> {
    const migrateUrl = this.connectionString(config.migrateUser, config.migratePassword, config);
    const appUrl = this.connectionString(config.appUser, config.appPassword, {
      ...config,
      database: DB_NAME,
    });
    const body = `# RC2.2 generated — do not commit
PGHOST=${config.host}
PGPORT=${config.port}
PGDATABASE=${DB_NAME}
DATABASE_URL=${appUrl}
DATABASE_URL_MIGRATE=${migrateUrl}
`;
    fs.mkdirSync(this.paths.configDir, { recursive: true });
    fs.writeFileSync(this.paths.backendEnvFile, body, 'utf8');
  }

  private connectionString(user: string, password: string, config: PostgresConnectionConfig): string {
    const enc = encodeURIComponent(password);
    return `postgresql://${user}:${enc}@${config.host}:${config.port}/${config.database}`;
  }
}
