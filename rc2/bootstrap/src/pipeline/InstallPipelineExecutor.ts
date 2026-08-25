import fs from 'node:fs';
import path from 'node:path';
import type { InstallPipelineContext, ComponentRegistryEntry } from './pipelineTypes.js';
import type { InstallStepId } from '../installSteps.js';
import { fetchHealthJson } from '@pontowebdesk/api-runtime';
import { SecretsStore } from '../postgres/SecretsStore.js';
import { execFileAsync, pgProcessEnv } from '../postgres/exec.js';

const PG_STEPS = new Set<InstallStepId>([
  'install_postgresql',
  'create_database',
  'apply_schema',
  'db_migrate_full',
]);

function writeComponentRegistry(
  ctx: InstallPipelineContext,
  entry: ComponentRegistryEntry,
): void {
  const file = path.join(ctx.paths.configDir, 'components.json');
  fs.mkdirSync(ctx.paths.configDir, { recursive: true });
  let list: ComponentRegistryEntry[] = [];
  if (fs.existsSync(file)) {
    try {
      list = JSON.parse(fs.readFileSync(file, 'utf8')) as ComponentRegistryEntry[];
    } catch {
      list = [];
    }
  }
  const idx = list.findIndex((e) => e.component === entry.component);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
}

function readProductVersionFile(installRoot: string): string | undefined {
  const ver = path.join(installRoot, 'VERSION');
  if (!fs.existsSync(ver)) return undefined;
  return fs.readFileSync(ver, 'utf8').trim();
}

export class InstallPipelineExecutor {
  constructor(private readonly ctx: InstallPipelineContext) {}

  async runStep(step: InstallStepId): Promise<void> {
    if (PG_STEPS.has(step)) {
      await this.runPostgresStep(step as 'install_postgresql' | 'create_database' | 'apply_schema' | 'db_migrate_full');
      return;
    }
    switch (step) {
      case 'import_initial_data':
        await this.importInitialData();
        return;
      case 'install_backend':
        await this.installBackend();
        return;
      case 'install_frontend':
        await this.installFrontend();
        return;
      case 'install_agent':
        await this.installAgent();
        return;
      case 'install_updater':
        await this.installUpdater();
        return;
      case 'register_services':
        await this.registerServices();
        return;
      case 'create_shortcuts':
        await this.createShortcuts();
        return;
      case 'first_run':
        await this.firstRun();
        return;
      default:
        throw new Error(`PIPELINE_STEP_UNSUPPORTED: ${step}`);
    }
  }

  private async runPostgresStep(
    step: 'install_postgresql' | 'create_database' | 'apply_schema' | 'db_migrate_full',
  ): Promise<void> {
    if (this.ctx.mode === 'structural' || this.ctx.postgresStub) {
      this.ctx.log.info('InstallPipelineExecutor.postgres structural/stub', { step });
      return;
    }
    if (!this.ctx.postgres) {
      throw new Error('POSTGRES_ORCHESTRATOR_MISSING');
    }
    await this.ctx.postgres.runStep(step);
    if (step === 'install_postgresql') {
      this.ctx.rollback.trackStarted('postgresql');
    }
  }

  private async importInitialData(): Promise<void> {
    const manifestVersion = this.ctx.layoutManifest.productVersion;
    const fileVersion = readProductVersionFile(this.ctx.paths.installRoot);
    if (fileVersion && fileVersion !== manifestVersion) {
      this.ctx.log.warn('import_initial_data version mismatch', { manifestVersion, fileVersion });
    }

    const candidates = [
      path.join(this.ctx.paths.migrationsDir, 'database', 'initial.sql'),
      path.join(this.ctx.paths.programDataRoot, 'Database', 'initial.sql'),
    ];
    const sqlFile = candidates.find((p) => fs.existsSync(p));

    if (this.ctx.mode === 'structural' || this.ctx.postgresStub) {
      this.ctx.log.info(
        sqlFile
          ? 'import_initial_data structural — file present'
          : 'import_initial_data structural — professional seed',
        sqlFile ? { sqlFile } : {},
      );
      return;
    }

    if (sqlFile) {
      const secrets = new SecretsStore(this.ctx.paths.secretsFile).load();
      if (!secrets) throw new Error('PG_SECRETS_MISSING');
      const psql = path.join(this.ctx.paths.databaseToolsDir, 'psql.exe');
      if (!fs.existsSync(psql)) throw new Error(`PSQL_MISSING: ${psql}`);
      const r = await execFileAsync(
        psql,
        [
          '-h',
          '127.0.0.1',
          '-p',
          String(secrets.port),
          '-U',
          'pontoweb_migrate',
          '-d',
          'pontowebdesk',
          '-v',
          'ON_ERROR_STOP=1',
          '-f',
          sqlFile,
        ],
        {
          env: pgProcessEnv(this.ctx.paths.databaseBinDir, {
            PGPASSWORD: secrets.pontowebMigratePassword,
          }),
          timeoutMs: 600_000,
        },
      );
      if (r.exitCode !== 0) {
        throw new Error(`IMPORT_INITIAL_DATA_FAILED: ${r.stderr || r.stdout}`);
      }
      this.ctx.log.info('import_initial_data OK', { sqlFile, version: manifestVersion });
      return;
    }

    await this.seedProfessionalDefaults();
  }

  /** Sem initial.sql: empresa + admin + colaborador padrão Professional. */
  private async seedProfessionalDefaults(): Promise<void> {
    const script = path.join(this.ctx.paths.binDir, 'seed-professional-defaults.mjs');
    if (!fs.existsSync(script)) {
      throw new Error(`SEED_PROFESSIONAL_SCRIPT_MISSING: ${script}`);
    }
    const store = new SecretsStore(this.ctx.paths.secretsFile);
    const secrets = store.loadOrCreate(55432);
    const cfg = store.toConnectionConfig(secrets);
    const encApp = encodeURIComponent(cfg.appPassword);
    const encMig = encodeURIComponent(cfg.migratePassword);
    const encSuper = encodeURIComponent(cfg.superuserPassword);
    const databaseUrl = `postgresql://${cfg.appUser}:${encApp}@${cfg.host}:${cfg.port}/pontowebdesk`;
    const databaseUrlMigrate = `postgresql://${cfg.migrateUser}:${encMig}@${cfg.host}:${cfg.port}/pontowebdesk`;
    // Seed precisa bypassar RLS (INSERT companies/users) — usa superuser embutido.
    const databaseUrlAdmin = `postgresql://${cfg.superuser}:${encSuper}@${cfg.host}:${cfg.port}/pontowebdesk`;
    const nodeModules = path.join(this.ctx.paths.backendRoot, 'server', 'node_modules');
    const r = await execFileAsync(this.ctx.paths.nodeExecutable, [script], {
      cwd: path.dirname(script),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATABASE_URL_MIGRATE: databaseUrlMigrate,
        DATABASE_URL_ADMIN: databaseUrlAdmin,
        DATABASE_SSL: 'false',
        RC2_BACKEND_NODE_MODULES: nodeModules,
      },
      timeoutMs: 120_000,
    });
    if (r.exitCode !== 0) {
      throw new Error(`SEED_PROFESSIONAL_FAILED: ${r.stderr || r.stdout}`);
    }
    this.ctx.log.info('import_initial_data OK — professional seed defaults');
  }

  private async installBackend(): Promise<void> {
    if (this.ctx.mode === 'structural' || this.ctx.backendInstallStub || !this.ctx.backendInstall) {
      this.ctx.log.info('install_backend structural/stub');
      return;
    }
    await this.ctx.backendInstall.installBackend();
    await this.ctx.backendInstall.validateHealth();
    this.ctx.rollback.trackStarted('api');
    this.ctx.log.info('install_backend OK — PontoWebDeskApi');
  }

  private async installFrontend(): Promise<void> {
    const index = path.join(this.ctx.paths.frontendWwwDir, 'index.html');
    const serveScript = path.join(this.ctx.paths.binDir, 'serve-frontend.mjs');
    if (!fs.existsSync(index)) {
      if (this.ctx.mode === 'structural') {
        this.ctx.log.warn('install_frontend structural — index.html absent');
        return;
      }
      throw new Error(`FRONTEND_WWW_MISSING: ${index}`);
    }
    if (!fs.existsSync(serveScript)) {
      if (this.ctx.mode === 'structural') {
        this.ctx.log.warn('install_frontend structural — serve-frontend.mjs absent');
        return;
      }
      throw new Error(`FRONTEND_SERVE_SCRIPT_MISSING: ${serveScript}`);
    }

    if (
      this.ctx.mode === 'full' &&
      !this.ctx.frontendInstallStub &&
      this.ctx.frontendInstall
    ) {
      try {
        await this.ctx.frontendInstall.installFrontend();
        await this.ctx.frontendInstall.validateFrontend();
        this.ctx.rollback.trackStarted('web');
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        try {
          await this.ctx.frontendInstall.rollbackFrontend(reason);
        } catch (rbErr) {
          this.ctx.log.warn('install_frontend rollback error', { err: String(rbErr) });
        }
        throw err;
      }
    } else if (this.ctx.mode === 'full' && !this.ctx.frontendInstallStub && !this.ctx.frontendInstall) {
      throw new Error('FRONTEND_INSTALL_PORT_MISSING');
    }

    const version = this.ctx.layoutManifest.components.frontend.version;
    writeComponentRegistry(this.ctx, {
      component: 'frontend',
      version,
      registeredAt: new Date().toISOString(),
      path: this.ctx.paths.frontendWwwDir,
    });
    this.ctx.log.info('install_frontend OK — PontoWebDeskFrontend', { index, serveScript });
  }

  private async installAgent(): Promise<void> {
    const agentExe = this.ctx.paths.agentRepExe;
    if (!fs.existsSync(agentExe)) {
      if (this.ctx.mode === 'structural') {
        this.ctx.log.warn('install_agent structural — rep-agent.exe absent');
        return;
      }
      throw new Error(`AGENT_EXE_MISSING: ${agentExe}`);
    }
    const version = this.ctx.layoutManifest.components.agent.version;
    writeComponentRegistry(this.ctx, {
      component: 'agent',
      version,
      registeredAt: new Date().toISOString(),
      path: agentExe,
    });
    if (this.ctx.mode === 'full' && !this.ctx.backendInstallStub) {
      await this.ctx.services.registerService('repAgent', 'PontoWebDeskAgent');
      this.ctx.rollback.trackStarted('repAgent');
    }
    this.ctx.log.info('install_agent OK', { agentExe });
  }

  private async installUpdater(): Promise<void> {
    this.ctx.log.info('install_updater deferred to RC2.4+ — outline OK');
    writeComponentRegistry(this.ctx, {
      component: 'updater',
      version: 'pending-rc2.4',
      registeredAt: new Date().toISOString(),
      path: path.join(this.ctx.paths.installRoot, 'Updater'),
    });
  }

  private async registerServices(): Promise<void> {
    const kinds = ['postgresql', 'api', 'web', 'repAgent'] as const;
    for (const kind of kinds) {
      const display =
        kind === 'postgresql'
          ? 'PontoWebDeskPostgreSQL'
          : kind === 'api'
            ? 'PontoWebDeskApi'
            : kind === 'web'
              ? 'PontoWebDeskFrontend'
              : 'PontoWebDeskAgent';
      await this.ctx.services.registerService(kind, display);
    }
    this.ctx.log.info('register_services OK');
  }

  private async createShortcuts(): Promise<void> {
    const url = 'http://127.0.0.1:3010/';
    const manifest = {
      createdAt: new Date().toISOString(),
      desktop: { name: 'PontoWebDesk', url },
      startMenu: { name: 'PontoWebDesk Professional', url },
    };
    fs.mkdirSync(this.ctx.paths.configDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.ctx.paths.configDir, 'shortcuts.manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    this.ctx.log.info('create_shortcuts OK (manifest only — Setup.exe cria atalhos físicos)');
  }

  private async firstRun(): Promise<void> {
    fs.mkdirSync(this.ctx.paths.configDir, { recursive: true });
    fs.mkdirSync(this.ctx.paths.storageDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.ctx.paths.pgdataDir), { recursive: true });

    const envFile = this.ctx.paths.backendEnvFile;
    if (!fs.existsSync(envFile)) {
      const template = path.join(this.ctx.paths.configDir, 'templates', 'backend.env.default');
      const body = fs.existsSync(template)
        ? fs.readFileSync(template, 'utf8')
        : 'NODE_ENV=production\nPORT=3000\nHOST=127.0.0.1\n';
      fs.writeFileSync(envFile, body, 'utf8');
    }

    if (this.ctx.mode === 'full' && !this.ctx.postgresStub) {
      const secrets = new SecretsStore(this.ctx.paths.secretsFile);
      secrets.loadOrCreate(5432);
    }

    if (this.ctx.mode === 'full' && this.ctx.backendInstall && !this.ctx.backendInstallStub) {
      try {
        const r = await fetchHealthJson(3011, '/api/health/ready');
        if (r.status !== 200) {
          this.ctx.log.warn('first_run health ready non-200', { status: r.status });
        }
      } catch (err) {
        this.ctx.log.warn('first_run health check skipped', { err: String(err) });
      }
    }

    if (this.ctx.mode === 'full' && this.ctx.frontendInstall && !this.ctx.frontendInstallStub) {
      try {
        await this.ctx.frontendInstall.validateFrontend();
      } catch (err) {
        this.ctx.log.warn('first_run frontend health failed', { err: String(err) });
        throw err;
      }
    }

    this.ctx.log.info('first_run OK — config inicial preparada');
  }
}

export { PG_STEPS };
