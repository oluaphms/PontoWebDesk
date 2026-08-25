import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MASTER_OWNER_1_EMAIL,
  DEFAULT_MASTER_OWNER_1_NAME,
  DEFAULT_MASTER_OWNER_2_EMAIL,
  DEFAULT_MASTER_OWNER_2_NAME,
  SecretsStore,
} from '../src/postgres/SecretsStore.js';
import {
  DEFAULT_MASTER_OWNER_1_PASSWORD,
  DEFAULT_MASTER_OWNER_2_PASSWORD,
  resolveProfessionalCompanySeedDefaults,
  resolveProfessionalMasterDefaults,
} from '../src/postgres/professionalSeedDefaults.js';
import { DatabaseProvisioner } from '../src/postgres/DatabaseProvisioner.js';
import { Logger } from '../src/Logger.js';
import type { DiscoveryResult } from '../src/postgres/PostgresDiscovery.js';
import type { BootstrapPaths } from '../src/types.js';
import { writeApiServiceHostConfig, defaultApiServicePaths } from '../../api-service/dist/ServiceConfig.js';

function tempRoots() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-master-boot-'));
  const configDir = path.join(tmp, 'Config');
  const logsDir = path.join(tmp, 'Logs');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  const secretsFile = path.join(configDir, 'secrets.json');
  const backendEnvFile = path.join(configDir, 'backend.env');
  const paths = {
    secretsFile,
    backendEnvFile,
    configDir,
    logsDir,
  } as unknown as BootstrapPaths;
  return { tmp, paths, secretsFile, backendEnvFile, configDir, logsDir };
}

const MASTER_ENV_KEYS = [
  'RC2_MASTER_OWNER_1_EMAIL',
  'RC2_MASTER_OWNER_1_NAME',
  'RC2_MASTER_OWNER_1_PASSWORD',
  'RC2_MASTER_OWNER_2_EMAIL',
  'RC2_MASTER_OWNER_2_NAME',
  'RC2_MASTER_OWNER_2_PASSWORD',
] as const;

describe('professionalSeedDefaults', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of MASTER_ENV_KEYS) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of MASTER_ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('resolveProfessionalMasterDefaults usa contas Professional', () => {
    const d = resolveProfessionalMasterDefaults();
    expect(d.owner1Email).toBe(DEFAULT_MASTER_OWNER_1_EMAIL);
    expect(d.owner2Email).toBe(DEFAULT_MASTER_OWNER_2_EMAIL);
    expect(d.owner1Password).toBe(DEFAULT_MASTER_OWNER_1_PASSWORD);
    expect(d.owner2Password).toBe(DEFAULT_MASTER_OWNER_2_PASSWORD);
    expect(d.owner1Password).not.toBe(d.owner2Password);
  });

  it('resolveProfessionalCompanySeedDefaults usa FL LOCADORA + admin/colaborador', () => {
    const d = resolveProfessionalCompanySeedDefaults();
    expect(d.companyName).toBe('FL LOCADORA LTDA');
    expect(d.companyCnpj).toBe('15048950000163');
    expect(d.adminEmail).toBe('admin@pontowebdesk.com');
    expect(d.collabEmail).toBe('paulohmorais@hotmail.com');
  });
});

describe('SecretsStore Master bootstrap', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of MASTER_ENV_KEYS) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of MASTER_ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('generate inclui MASTER_OWNER_1/2 Professional', () => {
    const { secretsFile, tmp } = tempRoots();
    const store = new SecretsStore(secretsFile);
    const a = store.generate(55432);
    const b = store.generate(55432);
    expect(a.masterJwtSecret!.length).toBeGreaterThanOrEqual(32);
    expect(a.masterOwner1Email).toBe(DEFAULT_MASTER_OWNER_1_EMAIL);
    expect(a.masterOwner1Name).toBe(DEFAULT_MASTER_OWNER_1_NAME);
    expect(a.masterOwner1Password).toBe(DEFAULT_MASTER_OWNER_1_PASSWORD);
    expect(a.masterOwner2Email).toBe(DEFAULT_MASTER_OWNER_2_EMAIL);
    expect(a.masterOwner2Name).toBe(DEFAULT_MASTER_OWNER_2_NAME);
    expect(a.masterOwner2Password).toBe(DEFAULT_MASTER_OWNER_2_PASSWORD);
    expect(a.masterJwtSecret).not.toBe(b.masterJwtSecret);
    expect(a.masterOwner1Password).not.toBe(a.masterOwner2Password);
    expect(a.masterJwtSecret).not.toMatch(/change-me|placeholder|generate-/i);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('persiste e segunda carga não regenera credenciais', () => {
    const { secretsFile, tmp } = tempRoots();
    const store = new SecretsStore(secretsFile);
    const first = store.loadOrCreate(55432);
    const second = store.loadOrCreate(55432);
    expect(second.masterJwtSecret).toBe(first.masterJwtSecret);
    expect(second.masterOwner1Password).toBe(first.masterOwner1Password);
    expect(second.masterOwner1Email).toBe(first.masterOwner1Email);
    expect(second.masterOwner2Password).toBe(first.masterOwner2Password);
    expect(second.masterOwner2Email).toBe(first.masterOwner2Email);
    const raw = fs.readFileSync(secretsFile, 'utf8');
    expect(raw).toContain('masterJwtSecret');
    expect(raw).toContain('masterOwner1Password');
    expect(raw).toContain('masterOwner2Password');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('ensureMasterBootstrap completa secrets antigos sem Master', () => {
    const { secretsFile, tmp } = tempRoots();
    const store = new SecretsStore(secretsFile);
    store.save({
      version: 1,
      postgresSuperuserPassword: 'x'.repeat(24),
      pontowebAppPassword: 'y'.repeat(24),
      pontowebMigratePassword: 'z'.repeat(24),
      jwtSecret: 'j'.repeat(48),
      port: 55432,
      createdAt: new Date().toISOString(),
    });
    const next = store.ensureInstallSecrets(store.load()!);
    expect(next.masterJwtSecret!.length).toBeGreaterThanOrEqual(32);
    expect(next.masterOwner1Email).toBe(DEFAULT_MASTER_OWNER_1_EMAIL);
    expect(next.masterOwner1Password).toBe(DEFAULT_MASTER_OWNER_1_PASSWORD);
    expect(next.masterOwner2Email).toBe(DEFAULT_MASTER_OWNER_2_EMAIL);
    expect(next.masterOwner2Password).toBe(DEFAULT_MASTER_OWNER_2_PASSWORD);
    const again = store.ensureInstallSecrets(store.load()!);
    expect(again.masterOwner1Password).toBe(next.masterOwner1Password);
    expect(again.masterOwner2Password).toBe(next.masterOwner2Password);
    expect(again.masterJwtSecret).toBe(next.masterJwtSecret);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('DatabaseProvisioner.writeBackendEnv Master', () => {
  it('escreve MASTER_PERSISTENCE, JWT e OWNER_1/2 no backend.env', async () => {
    const { paths, secretsFile, backendEnvFile, tmp, logsDir } = tempRoots();
    const store = new SecretsStore(secretsFile);
    store.loadOrCreate(55432);
    const log = new Logger({ logDir: logsDir, component: 'test' });
    const discovery = {
      ok: true,
      binDir: tmp,
      version: '16.8',
      postgresExe: path.join(tmp, 'postgres.exe'),
      psqlExe: path.join(tmp, 'psql.exe'),
      pgCtlExe: path.join(tmp, 'pg_ctl.exe'),
      initdbExe: path.join(tmp, 'initdb.exe'),
      pgIsReadyExe: path.join(tmp, 'pg_isready.exe'),
      errors: [],
    } as DiscoveryResult;
    const provisioner = new DatabaseProvisioner(paths, log, discovery);
    await provisioner.writeBackendEnv({
      host: '127.0.0.1',
      port: 55432,
      database: 'postgres',
      superuser: 'postgres',
      superuserPassword: 's',
      appUser: 'pontoweb_app',
      appPassword: 'a',
      migrateUser: 'pontoweb_migrate',
      migratePassword: 'm',
    });
    const env = fs.readFileSync(backendEnvFile, 'utf8');
    expect(env).toMatch(/^MASTER_PERSISTENCE=postgres$/m);
    expect(env).toMatch(/^MASTER_JWT_SECRET=.+$/m);
    expect(env).toMatch(/^MASTER_OWNER_1_EMAIL=.+$/m);
    expect(env).toMatch(/^MASTER_OWNER_1_PASSWORD=.+$/m);
    expect(env).toMatch(/^MASTER_OWNER_1_NAME=.+$/m);
    expect(env).toMatch(/^MASTER_OWNER_2_EMAIL=.+$/m);
    expect(env).toMatch(/^MASTER_OWNER_2_PASSWORD=.+$/m);
    expect(env).toMatch(/^MASTER_OWNER_2_NAME=.+$/m);
    expect(env).toMatch(/^RATE_LIMIT_REDIS_REQUIRED=false$/m);
    expect(env).toMatch(
      /^CORS_ORIGINS=http:\/\/127\.0\.0\.1:3010,http:\/\/localhost:3010$/m,
    );
    const jwt = /^MASTER_JWT_SECRET=(.+)$/m.exec(env)?.[1] ?? '';
    const pass = /^MASTER_OWNER_1_PASSWORD=(.+)$/m.exec(env)?.[1] ?? '';
    const pass2 = /^MASTER_OWNER_2_PASSWORD=(.+)$/m.exec(env)?.[1] ?? '';
    expect(jwt.length).toBeGreaterThanOrEqual(32);
    expect(pass.length).toBeGreaterThanOrEqual(8);
    expect(pass2.length).toBeGreaterThanOrEqual(8);
    expect(pass).not.toBe(pass2);
    expect(jwt).not.toMatch(/change-me|placeholder/i);

    const logRaw = fs.readFileSync(path.join(logsDir, 'install.log'), 'utf8');
    expect(logRaw).toMatch(/Master bootstrap credentials configured/);
    expect(logRaw).not.toContain(pass);
    expect(logRaw).not.toContain(pass2);
    expect(logRaw).not.toContain(jwt);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('API service host recebe MASTER_* do backend.env', () => {
  it('writeApiServiceHostConfig copia MASTER_* para api-service.env', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-api-master-'));
    const configDir = path.join(root, 'Config');
    const binDir = path.join(root, 'Bin');
    const logsDir = path.join(root, 'Logs');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'PontoWebDeskServiceHost.exe'), 'x', 'utf8');
    const backendEnvFile = path.join(configDir, 'backend.env');
    fs.writeFileSync(
      backendEnvFile,
      [
        'NODE_ENV=production',
        'PORT=3000',
        'JWT_SECRET=operational-jwt-secret-with-32bytes-min',
        'MASTER_PERSISTENCE=postgres',
        'MASTER_JWT_SECRET=master-jwt-secret-with-32bytes-minxx',
        'MASTER_OWNER_1_EMAIL=admciro@sergiponto.com.br',
        'MASTER_OWNER_1_PASSWORD=123456789',
        'MASTER_OWNER_1_NAME=Adm Ciro',
        'MASTER_OWNER_2_EMAIL=paulohmorais@hotmail.com',
        'MASTER_OWNER_2_PASSWORD=P@hms70548084',
        'MASTER_OWNER_2_NAME=Paulo Henrique',
        '',
      ].join('\n'),
      'utf8',
    );
    const paths = defaultApiServicePaths({
      programFilesRoot: root,
      programDataRoot: root,
      binDir,
      configDir,
      logsDir,
      backendEnvFile,
      nodeExecutable: path.join(root, 'node.exe'),
      backendEntry: path.join(root, 'server.js'),
      backendRoot: root,
      serviceHostScript: path.join(binDir, 'host.js'),
      storageDir: path.join(root, 'Storage'),
      apiRuntimeLogFile: path.join(logsDir, 'api-runtime.log'),
    });
    fs.writeFileSync(paths.nodeExecutable, 'node', 'utf8');
    fs.writeFileSync(paths.backendEntry, '//', 'utf8');
    writeApiServiceHostConfig(paths);
    const svcEnv = fs.readFileSync(path.join(configDir, 'api-service.env'), 'utf8');
    expect(svcEnv).toMatch(/^MASTER_PERSISTENCE=postgres$/m);
    expect(svcEnv).toMatch(/^MASTER_JWT_SECRET=master-jwt-secret-with-32bytes-minxx$/m);
    expect(svcEnv).toMatch(/^MASTER_OWNER_1_EMAIL=admciro@sergiponto\.com\.br$/m);
    expect(svcEnv).toMatch(/^MASTER_OWNER_2_EMAIL=paulohmorais@hotmail\.com$/m);
    const ini = fs.readFileSync(path.join(configDir, 'api-service-host.ini'), 'utf8');
    expect(ini).toMatch(/envFile=.*api-service\.env/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
