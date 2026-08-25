import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InstallPipelineExecutor } from '../src/pipeline/InstallPipelineExecutor.js';
import { RollbackCoordinator } from '../src/pipeline/RollbackCoordinator.js';
import { Logger } from '../src/Logger.js';
import { ServiceManager } from '../src/ServiceManager.js';
import { minimalLayoutManifest, writeInstalledLayoutFixture } from './layoutFixture.js';
import { InstallationContext } from '@pontowebdesk/api-runtime';
import { toBootstrapPaths } from '../src/runtime/bootstrapPaths.js';

function pipelineCtx(tmp: string, mode: 'full' | 'structural' = 'structural') {
  const installRoot = path.join(tmp, 'PF', 'PontoWebDesk');
  const programDataRoot = path.join(tmp, 'PD', 'PontoWebDesk');
  writeInstalledLayoutFixture({ installRoot, programDataRoot, touchFiles: true });
  const ctx = InstallationContext.load({ programFilesRoot: installRoot, programDataRoot });
  const paths = toBootstrapPaths(ctx.paths);
  const logDir = path.join(programDataRoot, 'Logs');
  fs.mkdirSync(logDir, { recursive: true });
  const log = new Logger({ logDir, component: 'test' });
  return {
    executor: new InstallPipelineExecutor({
      mode,
      paths,
      layoutManifest: ctx.layoutManifest,
      log,
      services: new ServiceManager(log),
      postgresStub: true,
      backendInstallStub: true,
      frontendInstallStub: true,
      rollback: new RollbackCoordinator(log),
    }),
    paths,
    programDataRoot,
  };
}

describe('InstallPipelineExecutor', () => {
  it('install_frontend registra components.json', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pl-fe-'));
    const { executor, programDataRoot } = pipelineCtx(tmp);
    await executor.runStep('install_frontend');
    const reg = path.join(programDataRoot, 'Config', 'components.json');
    expect(fs.existsSync(reg)).toBe(true);
    const list = JSON.parse(fs.readFileSync(reg, 'utf8')) as { component: string }[];
    expect(list.some((e) => e.component === 'frontend')).toBe(true);
  });

  it('install_agent registra agent', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pl-ag-'));
    const { executor, programDataRoot } = pipelineCtx(tmp);
    await executor.runStep('install_agent');
    const reg = path.join(programDataRoot, 'Config', 'components.json');
    const list = JSON.parse(fs.readFileSync(reg, 'utf8')) as { component: string }[];
    expect(list.some((e) => e.component === 'agent')).toBe(true);
  });

  it('create_shortcuts grava shortcuts.manifest.json', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pl-sc-'));
    const { executor, programDataRoot } = pipelineCtx(tmp);
    await executor.runStep('create_shortcuts');
    expect(fs.existsSync(path.join(programDataRoot, 'Config', 'shortcuts.manifest.json'))).toBe(true);
  });

  it('first_run cria backend.env se ausente', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pl-fr-'));
    const { executor, paths } = pipelineCtx(tmp);
    await executor.runStep('first_run');
    expect(fs.existsSync(paths.backendEnvFile)).toBe(true);
  });

  it('import_initial_data structural sem initial.sql (professional seed path)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pl-id-'));
    const { executor } = pipelineCtx(tmp);
    await expect(executor.runStep('import_initial_data')).resolves.toBeUndefined();
  });

  it('install_backend chama port quando full', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pl-be-'));
    const installRoot = path.join(tmp, 'PF', 'PontoWebDesk');
    const programDataRoot = path.join(tmp, 'PD', 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot, touchFiles: true });
    const ctx = InstallationContext.load({ programFilesRoot: installRoot, programDataRoot });
    const paths = toBootstrapPaths(ctx.paths);
    const log = new Logger({ logDir: path.join(programDataRoot, 'Logs'), component: 'test' });
    const installBackend = vi.fn(async () => {});
    const validateHealth = vi.fn(async () => {});
    const executor = new InstallPipelineExecutor({
      mode: 'full',
      paths,
      layoutManifest: ctx.layoutManifest,
      log,
      services: new ServiceManager(log),
      backendInstall: { installBackend, validateHealth },
      backendInstallStub: false,
      postgresStub: true,
      rollback: new RollbackCoordinator(log),
    });
    await executor.runStep('install_backend');
    expect(installBackend).toHaveBeenCalled();
    expect(validateHealth).toHaveBeenCalled();
  });

  it('install_frontend chama port quando full', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pl-fe-full-'));
    const installRoot = path.join(tmp, 'PF', 'PontoWebDesk');
    const programDataRoot = path.join(tmp, 'PD', 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot, touchFiles: true });
    const ctx = InstallationContext.load({ programFilesRoot: installRoot, programDataRoot });
    const paths = toBootstrapPaths(ctx.paths);
    const log = new Logger({ logDir: path.join(programDataRoot, 'Logs'), component: 'test' });
    const installFrontend = vi.fn(async () => {});
    const validateFrontend = vi.fn(async () => {});
    const rollbackFrontend = vi.fn(async () => {});
    const executor = new InstallPipelineExecutor({
      mode: 'full',
      paths,
      layoutManifest: ctx.layoutManifest,
      log,
      services: new ServiceManager(log),
      frontendInstall: { installFrontend, validateFrontend, rollbackFrontend },
      frontendInstallStub: false,
      postgresStub: true,
      backendInstallStub: true,
      rollback: new RollbackCoordinator(log),
    });
    await executor.runStep('install_frontend');
    expect(installFrontend).toHaveBeenCalled();
    expect(validateFrontend).toHaveBeenCalled();
  });
});

describe('RollbackCoordinator', () => {
  it('rollback não lança', async () => {
    const log = new Logger({ logDir: os.tmpdir(), component: 'test' });
    const rb = new RollbackCoordinator(log);
    rb.trackStarted('api');
    await expect(rb.rollbackStartedServices('test')).resolves.toBeUndefined();
  });
});

describe('InstallManager completedSteps', () => {
  it('preenche completedSteps após structural run', async () => {
    if (os.platform() !== 'win32') return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pl-mgr-'));
    const installRoot = path.join(tmp, 'ProgramFiles', 'PontoWebDesk');
    const programDataRoot = path.join(tmp, 'ProgramData', 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot, touchFiles: true });
    const { Bootstrap } = await import('../src/Bootstrap.js');
    const bootstrap = new Bootstrap({
      programFilesRoot: installRoot,
      programDataRoot,
      embeddedPostgres: false,
    });
    const result = await bootstrap.runStructuralDryRun();
    expect(result.ok).toBe(true);
    const doc = JSON.parse(
      fs.readFileSync(path.join(programDataRoot, 'install-state.json'), 'utf8'),
    );
    expect(doc.completedSteps?.length).toBe(12);
    expect(doc.startedAt).toBeTruthy();
    expect(doc.finishedAt).toBeTruthy();
    expect(doc.phase).toContain('rc2.4.2');
  });
});
