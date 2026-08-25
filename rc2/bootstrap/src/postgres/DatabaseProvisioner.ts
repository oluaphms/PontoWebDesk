import fs from 'node:fs';
import path from 'node:path';
import type { BootstrapPaths, PostgresConnectionConfig } from '../types.js';
import type { Logger } from '../Logger.js';
import type { DiscoveryResult } from './PostgresDiscovery.js';
import { execFileAsync, pgProcessEnv } from './exec.js';
import { SecretsStore } from './SecretsStore.js';

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
    CREATE ROLE ${config.migrateUser} LOGIN PASSWORD '${this.esc(config.migratePassword)}' CREATEDB CREATEROLE;
  ELSE
    ALTER ROLE ${config.migrateUser} WITH LOGIN PASSWORD '${this.esc(config.migratePassword)}' CREATEDB CREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${config.appUser}') THEN
    CREATE ROLE ${config.appUser} LOGIN PASSWORD '${this.esc(config.appPassword)}';
  ELSE
    ALTER ROLE ${config.appUser} WITH LOGIN PASSWORD '${this.esc(config.appPassword)}';
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

  /**
   * Migrations rodam como postgres — DEFAULT PRIVILEGES do migrate user não cobrem.
   * Necessário para pontoweb_app (DATABASE_URL) gravar master_users via ensureBootstrapOwners.
   */
  async grantAppDmlPrivileges(config: PostgresConnectionConfig): Promise<void> {
    await this.runPsqlAdmin(
      { ...config, database: DB_NAME },
      'postgres',
      `
GRANT USAGE ON SCHEMA public TO ${config.appUser};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${config.appUser};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${config.appUser};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${config.appUser};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${config.appUser};
`,
    );
    this.log.info('DatabaseProvisioner.grantAppDmlPrivileges OK', { role: config.appUser });
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
    const env = pgProcessEnv(this.discovery.binDir, {
      PGPASSWORD: password ?? config.superuserPassword,
    });
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

  async writeBackendEnv(config: PostgresConnectionConfig): Promise<void> {
    const store = new SecretsStore(this.paths.secretsFile);
    const loaded = store.load();
    if (!loaded) throw new Error('PG_SECRETS_MISSING');
    const secrets = store.ensureInstallSecrets(loaded);

    const migrateUrl = this.connectionString(config.migrateUser, config.migratePassword, {
      ...config,
      database: DB_NAME,
    });
    const appUrl = this.connectionString(config.appUser, config.appPassword, {
      ...config,
      database: DB_NAME,
    });

    const jwtSecret = secrets.jwtSecret!;
    const masterJwt = secrets.masterJwtSecret!;
    const ownerEmail = secrets.masterOwner1Email!;
    const ownerPassword = secrets.masterOwner1Password!;
    const ownerName = secrets.masterOwner1Name!;
    const owner2Email = secrets.masterOwner2Email!;
    const owner2Password = secrets.masterOwner2Password!;
    const owner2Name = secrets.masterOwner2Name!;

    const body = `# RC2.2 generated — do not commit
NODE_ENV=production
PORT=3000
PGHOST=${config.host}
PGPORT=${config.port}
PGDATABASE=${DB_NAME}
DATABASE_URL=${appUrl}
DATABASE_URL_MIGRATE=${migrateUrl}
JWT_SECRET=${jwtSecret}
VPS_RLS_ENFORCED=true
MASTER_PERSISTENCE=postgres
MASTER_JWT_SECRET=${masterJwt}
MASTER_OWNER_1_EMAIL=${ownerEmail}
MASTER_OWNER_1_PASSWORD=${ownerPassword}
MASTER_OWNER_1_NAME=${ownerName}
MASTER_OWNER_2_EMAIL=${owner2Email}
MASTER_OWNER_2_PASSWORD=${owner2Password}
MASTER_OWNER_2_NAME=${owner2Name}
RATE_LIMIT_REDIS_REQUIRED=false
CORS_ORIGINS=http://127.0.0.1:3010,http://localhost:3010
`;
    fs.mkdirSync(this.paths.configDir, { recursive: true });
    fs.writeFileSync(this.paths.backendEnvFile, body, 'utf8');
    this.log.info('Master bootstrap credentials configured', {
      email: ownerEmail,
      email2: owner2Email,
    });
  }

  private connectionString(user: string, password: string, config: PostgresConnectionConfig): string {
    const enc = encodeURIComponent(password);
    return `postgresql://${user}:${enc}@${config.host}:${config.port}/${config.database}`;
  }
}
