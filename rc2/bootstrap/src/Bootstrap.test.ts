import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canTransition, assertTransition } from './stateMachine.js';
import { INSTALL_STATES } from './types.js';
import type { InstallStateName } from './types.js';
import { InstallStateStore } from './InstallState.js';
import { Bootstrap } from './Bootstrap.js';
import { RecoveryManager } from './RecoveryManager.js';
import { Logger } from './Logger.js';
import { ServiceManager } from './ServiceManager.js';
import { INSTALLING_PIPELINE_STEPS, INSTALL_STEPS } from './installSteps.js';
import { writeInstalledLayoutFixture } from '../tests/layoutFixture.js';

const ALL_STATES = INSTALL_STATES as readonly InstallStateName[];

function testRoots(label: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), label));
  const installRoot = path.join(tmp, 'ProgramFiles', 'PontoWebDesk');
  const programDataRoot = path.join(tmp, 'ProgramData', 'PontoWebDesk');
  writeInstalledLayoutFixture({ installRoot, programDataRoot });
  return { installRoot, programDataRoot };
}

describe('stateMachine', () => {
  it('allows NOT_STARTED -> PRECHECK', () => {
    expect(canTransition('NOT_STARTED', 'PRECHECK')).toBe(true);
  });

  it('denies NOT_STARTED -> INSTALLED', () => {
    expect(canTransition('NOT_STARTED', 'INSTALLED')).toBe(false);
  });

  it('denies FAILED -> PRECHECK (retry via RECOVERY only)', () => {
    expect(canTransition('FAILED', 'PRECHECK')).toBe(false);
  });

  it('allows INSTALLING -> INSTALLED', () => {
    expect(canTransition('INSTALLING', 'INSTALLED')).toBe(true);
  });

  it('matrix: invalid transitions throw', () => {
    expect(() => assertTransition('INSTALLED', 'PRECHECK')).toThrow(/INVALID_STATE_TRANSITION/);
  });
});

describe('InstallStateStore', () => {
  it('transitions with history and step', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-state-'));
    const file = path.join(tmp, 'install-state.json');
    const store = new InstallStateStore(file);
    let doc = store.ensureFileExists();
    expect(doc.currentStep).toBe('idle');
    doc = store.transition(doc, 'PRECHECK', 'test', undefined, 'precheck');
    expect(doc.history.some((h) => h.step === 'precheck')).toBe(true);
  });

  it('quarantines corrupt JSON into FAILED', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-corrupt-'));
    const file = path.join(tmp, 'install-state.json');
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(file, '{ not-json', 'utf8');
    const store = new InstallStateStore(file);
    const doc = store.load();
    expect(doc.state).toBe('FAILED');
    expect(doc.lastError?.code).toBe('EX001_INSTALL_STATE_CORRUPT');
    expect(fs.readdirSync(tmp).some((f) => f.includes('corrupt'))).toBe(true);
  });
});

describe('RecoveryManager', () => {
  it('retryFromFailed reaches NOT_STARTED', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-rec-'));
    const file = path.join(tmp, 'install-state.json');
    const logDir = path.join(tmp, 'logs');
    const store = new InstallStateStore(file);
    const log = new Logger({ logDir, component: 'test' });
    const recovery = new RecoveryManager(store, log, new ServiceManager(log));
    let doc = store.ensureFileExists();
    doc = store.transition(doc, 'PRECHECK', 'x', undefined, 'precheck');
    doc = store.markFailed(doc, 'T', 'fail', 'precheck');
    doc = recovery.retryFromFailed(doc);
    expect(doc.state).toBe('NOT_STARTED');
    expect(doc.currentStep).toBe('idle');
  });
});

describe('Bootstrap structural pipeline', () => {
  it('writes install-state.json and reaches INSTALLED on win32', async () => {
    const { installRoot, programDataRoot } = testRoots('pwd-rc2-');
    const bootstrap = new Bootstrap({
      programFilesRoot: installRoot,
      programDataRoot,
      embeddedPostgres: false,
    });
    const result = await bootstrap.runStructuralDryRun();
    const statePath = path.join(programDataRoot, 'install-state.json');
    expect(fs.existsSync(statePath)).toBe(true);
    const doc = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (os.platform() === 'win32') {
      expect(result.ok).toBe(true);
      expect(result.finalState).toBe('INSTALLED');
      expect(result.finalStep).toBe('completed');
      expect(doc.currentStep).toBe('completed');
    } else {
      expect(result.ok).toBe(false);
      expect(result.finalState).toBe('FAILED');
    }
    expect(doc.state).toBe(result.finalState);
  });

  it('persists every INSTALLING pipeline step on win32', async () => {
    if (os.platform() !== 'win32') return;
    const { installRoot, programDataRoot } = testRoots('pwd-rc2-steps-');
    const bootstrap = new Bootstrap({
      programFilesRoot: installRoot,
      programDataRoot,
      embeddedPostgres: false,
    });
    await bootstrap.runStructuralDryRun();
    const doc = JSON.parse(
      fs.readFileSync(path.join(programDataRoot, 'install-state.json'), 'utf8'),
    );
    const stepsInHistory = new Set(doc.history.map((h: { step?: string }) => h.step).filter(Boolean));
    for (const step of INSTALLING_PIPELINE_STEPS) {
      expect(stepsInHistory.has(step)).toBe(true);
    }
  });

  it('simulated step failure enters RECOVERY on win32', async () => {
    if (os.platform() !== 'win32') return;
    const { installRoot, programDataRoot } = testRoots('pwd-rc2-fail-');
    const bootstrap = new Bootstrap({
      programFilesRoot: installRoot,
      programDataRoot,
      embeddedPostgres: false,
      simulateFailureAtStep: 'apply_schema',
    });
    const result = await bootstrap.runStructuralDryRun();
    expect(result.ok).toBe(false);
    expect(result.finalState).toBe('RECOVERY');
    expect(result.finalStep).toBe('precheck');
  });
});

describe('installSteps catalog', () => {
  it('matches RC2-ARCH pipeline order length', () => {
    expect(INSTALL_STEPS[0]).toBe('idle');
    expect(INSTALL_STEPS.at(-1)).toBe('completed');
    expect(INSTALLING_PIPELINE_STEPS.length).toBe(12);
  });
});
