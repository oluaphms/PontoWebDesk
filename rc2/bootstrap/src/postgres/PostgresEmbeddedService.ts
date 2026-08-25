import fs from 'node:fs';
import path from 'node:path';
import type { BootstrapPaths } from '../types.js';
import type { Logger } from '../Logger.js';
import type { DiscoveryResult } from './PostgresDiscovery.js';
import { execFileAsync, pgProcessEnv } from './exec.js';

const SERVICE_NAME = 'PontoWebDeskPostgreSQL';

export interface ClusterInitOptions {
  port: number;
  superuserPassword: string;
}

/**
 * Cluster PostgreSQL embarcado: initdb, config, pg_ctl register/start, health.
 */
export class PostgresEmbeddedService {
  constructor(
    private readonly paths: BootstrapPaths,
    private readonly log: Logger,
    private readonly discovery: DiscoveryResult,
  ) {}

  getServiceName(): string {
    return SERVICE_NAME;
  }

  private pgEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return pgProcessEnv(this.discovery.binDir, extra);
  }

  isClusterInitialized(): boolean {
    return fs.existsSync(path.join(this.paths.pgdataDir, 'PG_VERSION'));
  }

  async initCluster(options: ClusterInitOptions): Promise<void> {
    if (this.isClusterInitialized()) {
      this.log.info('PostgresEmbeddedService.initCluster skipped — PG_VERSION exists');
      await this.writeConfigs(options.port);
      return;
    }
    fs.mkdirSync(path.dirname(this.paths.pgdataDir), { recursive: true });
    const locale = process.env['RC2_PG_LOCALE'] ?? 'Portuguese_Brazil.1252';
    const args = [
      '-D',
      this.paths.pgdataDir,
      '-U',
      'postgres',
      '-E',
      'UTF8',
      '--locale=' + locale,
      '--data-checksums',
    ];
    const r = await execFileAsync(this.discovery.initdbExe, args, {
      timeoutMs: 120_000,
      env: this.pgEnv(),
    });
    if (r.exitCode !== 0) {
      throw new Error(`INITDB_FAILED: ${r.stderr || r.stdout}`);
    }
    await this.writeConfigs(options.port);
    await this.writeBootstrapHbaTrust();
    this.log.info('PostgresEmbeddedService.initCluster OK', { pgdata: this.paths.pgdataDir });
  }

  async writeBootstrapHbaTrust(): Promise<void> {
    const hba = path.join(this.paths.pgdataDir, 'pg_hba.conf');
    const hbaBody = `# RC2 bootstrap trust (temporary)
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
`;
    fs.writeFileSync(hba, hbaBody, 'utf8');
  }

  async writeProductionHba(): Promise<void> {
    const hba = path.join(this.paths.pgdataDir, 'pg_hba.conf');
    const hbaBody = `# RC2 embedded generated
local   all             postgres                                scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
`;
    fs.writeFileSync(hba, hbaBody, 'utf8');
    await this.reloadHba();
  }

  async writeConfigs(port: number): Promise<void> {
    const conf = path.join(this.paths.pgdataDir, 'postgresql.conf');
    const confBody = `# RC2 embedded generated
listen_addresses = '127.0.0.1'
port = ${port}
max_connections = 100
shared_buffers = 256MB
timezone = 'America/Sao_Paulo'
log_timezone = 'America/Sao_Paulo'
logging_collector = off
`;
    fs.writeFileSync(conf, confBody, 'utf8');
  }

  async registerService(): Promise<void> {
    const r = await execFileAsync(
      this.discovery.pgCtlExe,
      [
        'register',
        '-N',
        SERVICE_NAME,
        '-D',
        this.paths.pgdataDir,
        '-S',
        'auto',
        '-o',
        `-p ${await this.readPortFromConfig()}`,
      ],
      { timeoutMs: 60_000, env: this.pgEnv() },
    );
    if (r.exitCode !== 0) {
      throw new Error(`PG_CTL_REGISTER_FAILED: ${r.stderr || r.stdout}`);
    }
    this.log.info('PostgresEmbeddedService.registerService OK', { service: SERVICE_NAME });
  }

  private async readPortFromConfig(): Promise<number> {
    const conf = path.join(this.paths.pgdataDir, 'postgresql.conf');
    const raw = fs.readFileSync(conf, 'utf8');
    const m = /^port\s*=\s*(\d+)/m.exec(raw);
    return m ? Number(m[1]) : 5432;
  }

  async startWindowsService(): Promise<void> {
    const r = await execFileAsync('net.exe', ['start', SERVICE_NAME], {
      timeoutMs: 120_000,
      env: this.pgEnv(),
    });
    if (r.exitCode !== 0) {
      const detail = (r.stderr || r.stdout).trim();
      // Já em execução via SCM — ok.
      if (/já foi iniciado|already been started|1056/i.test(detail)) {
        this.log.info('PostgresEmbeddedService.startWindowsService already running', {
          service: SERVICE_NAME,
        });
        return;
      }
      throw new Error(`PG_SERVICE_START_FAILED: ${detail}`);
    }
    this.log.info('PostgresEmbeddedService.startWindowsService OK', { service: SERVICE_NAME });
  }

  /** Para cluster fora do SCM (ex.: pg_ctl órfão após rollback) para liberar pgdata/porta. */
  async stop(): Promise<void> {
    const r = await execFileAsync(
      this.discovery.pgCtlExe,
      ['stop', '-D', this.paths.pgdataDir, '-m', 'fast'],
      { timeoutMs: 60_000, env: this.pgEnv() },
    );
    if (r.exitCode !== 0) {
      const detail = (r.stderr || r.stdout).trim();
      if (/not running|não está em execução|is not running/i.test(detail)) {
        this.log.info('PostgresEmbeddedService.stop skipped — not running');
        return;
      }
      // postmaster.pid stale / processo morto
      this.log.warn('PostgresEmbeddedService.stop non-zero', { detail });
      return;
    }
    this.log.info('PostgresEmbeddedService.stop OK');
  }

  async isWindowsServiceRunning(): Promise<boolean> {
    const r = await execFileAsync('sc.exe', ['query', SERVICE_NAME], {
      timeoutMs: 15_000,
      env: this.pgEnv(),
    });
    const out = `${r.stdout}\n${r.stderr}`;
    // PT-BR: "ESTADO ... : 4  RUNNING"; EN: "STATE ..."
    return /(?:STATE|ESTADO)\s*:\s*\d+\s+RUNNING/i.test(out);
  }

  async start(): Promise<void> {
    const port = await this.readPortFromConfig();
    try {
      await this.waitReady(port, 5_000);
      this.log.info('PostgresEmbeddedService.start skipped — cluster already ready', { port });
      return;
    } catch {
      /* segue para pg_ctl start */
    }

    const r = await execFileAsync(
      this.discovery.pgCtlExe,
      ['start', '-D', this.paths.pgdataDir],
      { timeoutMs: 30_000, env: this.pgEnv() },
    );
    if (r.exitCode !== 0) {
      const detail = (r.stderr || r.stdout).trim();
      try {
        await this.waitReady(port, 10_000);
        this.log.warn('PostgresEmbeddedService.start pg_ctl non-zero but cluster ready', {
          port,
          stderr: detail,
        });
        return;
      } catch {
        throw new Error(`PG_CTL_START_FAILED: ${detail}`);
      }
    }
    await this.waitReady(port, 120_000);
  }

  async waitReady(port: number, timeoutMs = 120_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const r = await execFileAsync(
        this.discovery.pgIsReadyExe,
        ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres'],
        { timeoutMs: 10_000, env: this.pgEnv() },
      );
      if (r.exitCode === 0) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error('PG_ISREADY_TIMEOUT');
  }

  private async reloadHba(): Promise<void> {
    await execFileAsync(this.discovery.pgCtlExe, ['reload', '-D', this.paths.pgdataDir], {
      timeoutMs: 30_000,
      env: this.pgEnv(),
    });
  }

  async setSuperuserPassword(password: string, port: number): Promise<void> {
    const probe = await execFileAsync(
      this.discovery.psqlExe,
      ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-c', 'SELECT 1;'],
      { env: this.pgEnv({ PGPASSWORD: password }), timeoutMs: 15_000 },
    );
    if (probe.exitCode === 0) {
      this.log.info('PostgresEmbeddedService.setSuperuserPassword skipped — password already valid');
      return;
    }

    await this.writeBootstrapHbaTrust();
    await this.reloadHba();

    const r = await execFileAsync(
      this.discovery.psqlExe,
      [
        '-h',
        '127.0.0.1',
        '-p',
        String(port),
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        `ALTER USER postgres WITH PASSWORD '${password.replace(/'/g, "''")}';`,
      ],
      { env: this.pgEnv({ PGPASSWORD: '' }), timeoutMs: 30_000 },
    );
    if (r.exitCode !== 0) {
      throw new Error(`PG_SUPERUSER_PASSWORD_FAILED: ${r.stderr || r.stdout}`);
    }
  }
}
