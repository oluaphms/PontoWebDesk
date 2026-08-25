import fs from 'node:fs';
import path from 'node:path';
import type { BootstrapPaths, PostgresConnectionConfig } from '../types.js';
import type { Logger } from '../Logger.js';
import { PostgresDiscovery } from './PostgresDiscovery.js';
import { allocatePostgresPort } from './PostgresPortCheck.js';
import { SecretsStore } from './SecretsStore.js';
import { PostgresEmbeddedService } from './PostgresEmbeddedService.js';
import { DatabaseProvisioner } from './DatabaseProvisioner.js';
import { DbMigrateRunner } from './DbMigrateRunner.js';

export interface PostgresInstallOrchestratorOptions {
  /** Caminho alternativo para Database\\bin (dev / testes) */
  pgBinOverride?: string;
  /** Não invocar binários reais */
  stub?: boolean;
}

/**
 * Orquestra steps RC2.2: install_postgresql → db_migrate_full.
 */
export class PostgresInstallOrchestrator {
  private readonly discovery: PostgresDiscovery;
  private readonly secrets: SecretsStore;

  constructor(
    private readonly paths: BootstrapPaths,
    private readonly log: Logger,
    private readonly options: PostgresInstallOrchestratorOptions = {},
  ) {
    this.discovery = new PostgresDiscovery(paths, options.pgBinOverride);
    this.secrets = new SecretsStore(paths.secretsFile);
  }

  async runStep(
    step: 'install_postgresql' | 'create_database' | 'apply_schema' | 'db_migrate_full',
  ): Promise<void> {
    if (this.options.stub) {
      this.log.info('PostgresInstallOrchestrator.stub', { step });
      return;
    }

    const discovered = await this.discovery.verifyVersion(this.discovery.discover());
    if (!discovered.ok) {
      throw new Error(discovered.errors.join('; '));
    }

    switch (step) {
      case 'install_postgresql':
        await this.installPostgresql(discovered);
        return;
      case 'create_database':
        await this.createDatabase(discovered);
        return;
      case 'apply_schema':
        await this.applySchema();
        return;
      case 'db_migrate_full':
        await this.migrateFull(discovered);
        return;
      default:
        throw new Error(`PG_STEP_UNKNOWN: ${step}`);
    }
  }

  private async installPostgresql(discovered: Awaited<ReturnType<PostgresDiscovery['discover']>>): Promise<void> {
    const port = this.secrets.load()?.port ?? (await allocatePostgresPort());
    const secrets = this.secrets.loadOrCreate(port);
    const pg = new PostgresEmbeddedService(this.paths, this.log, discovered);
    await pg.initCluster({ port, superuserPassword: secrets.postgresSuperuserPassword });
    if (process.platform === 'win32') {
      try {
        await pg.registerService();
      } catch (err) {
        this.log.warn('PostgresEmbeddedService.registerService failed — service may already exist', {
          err: String(err),
        });
      }
      try {
        await pg.startWindowsService();
      } catch (err) {
        // Rollback deixa postgres.exe órfão via pg_ctl; SCM não sobe enquanto o cluster está up.
        this.log.warn(
          'PostgresEmbeddedService.startWindowsService failed — stopping orphan cluster and retrying SCM',
          { err: String(err) },
        );
        await pg.stop();
        await pg.startWindowsService();
      }
      // Aguarda o SCM refletir RUNNING (sc query PT/EN) após net start.
      let running = false;
      for (let i = 0; i < 10; i++) {
        running = await pg.isWindowsServiceRunning();
        if (running) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!running) {
        throw new Error(
          'PG_SERVICE_NOT_RUNNING: PontoWebDeskPostgreSQL must be Running (pg_ctl-only is not accepted)',
        );
      }
    } else {
      await pg.start();
    }
    await pg.waitReady(port);
    await pg.setSuperuserPassword(secrets.postgresSuperuserPassword, port);
    await pg.writeProductionHba();
    this.log.info('PostgresInstallOrchestrator.installPostgresql OK', { port });
  }

  private async createDatabase(discovered: Awaited<ReturnType<PostgresDiscovery['discover']>>): Promise<void> {
    const loaded = this.secrets.load();
    if (!loaded) throw new Error('PG_SECRETS_MISSING');
    const secrets = this.secrets.ensureInstallSecrets(loaded);
    const base = this.secrets.toConnectionConfig(secrets);
    const config: PostgresConnectionConfig = { ...base, database: 'postgres' };
    const provisioner = new DatabaseProvisioner(this.paths, this.log, discovered);
    await provisioner.provision(config);
  }

  private async applySchema(): Promise<void> {
    const migrations = this.paths.migrationsDir;
    const bootstrap = path.join(migrations, 'backend', 'db', 'vps', 'bootstrap.sql');
    const base = path.join(migrations, 'supabase_full_schema.sql');
    for (const file of [bootstrap, base]) {
      if (!fs.existsSync(file)) {
        throw new Error(`SCHEMA_FILE_MISSING: ${file}`);
      }
    }
    this.log.info('PostgresInstallOrchestrator.applySchema OK — files present; migrate at db_migrate_full');
  }

  private async migrateFull(
    discovered: Awaited<ReturnType<PostgresDiscovery['discover']>>,
  ): Promise<void> {
    const loaded = this.secrets.load();
    if (!loaded) throw new Error('PG_SECRETS_MISSING');
    const secrets = this.secrets.ensureInstallSecrets(loaded);
    const base = this.secrets.toConnectionConfig(secrets);
    // Schema Supabase cria roles com BYPASSRLS — exige superuser no install inicial.
    const migrateUrl = `postgresql://${base.superuser}:${encodeURIComponent(base.superuserPassword)}@${base.host}:${base.port}/pontowebdesk`;
    const runner = new DbMigrateRunner(this.paths, this.log);
    await runner.runMigrateFull(migrateUrl);

    // Tabelas criadas como postgres: conceder DML ao app (Master + operacional).
    const provisioner = new DatabaseProvisioner(this.paths, this.log, discovered);
    const config: PostgresConnectionConfig = { ...base, database: 'postgres' };
    await provisioner.grantAppDmlPrivileges(config);
    // Regrava backend.env com MASTER_* (idempotente) antes do install_backend copiar para o serviço.
    await provisioner.writeBackendEnv(config);
  }
}
