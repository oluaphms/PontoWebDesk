import { describe, expect, it } from 'vitest';
import { parseScQueryState } from '../src/scExec.js';
import { buildServiceBinPath, RECOVERY_ACTIONS } from '../src/ServiceConfig.js';

describe('scExec helpers', () => {
  it('parse STOPPED', () => {
    expect(parseScQueryState('STATE : 1 STOPPED')).toBe('STOPPED');
  });
});

describe('recovery constants', () => {
  it('três ações de restart', () => {
    expect(RECOVERY_ACTIONS).toHaveLength(3);
    expect(RECOVERY_ACTIONS[0]?.delayMs).toBe(5000);
  });
});

describe('buildServiceBinPath quotes', () => {
  it('paths com espaços', () => {
    const p = buildServiceBinPath({
      programFilesRoot: 'C:\\pf',
      programDataRoot: 'C:\\pd',
      binDir: 'C:\\pf\\Bin',
      serviceHostScript: 'C:\\Program Files\\PontoWebDesk\\Bin\\host.js',
      nodeExecutable: 'C:\\Program Files\\PontoWebDesk\\Backend\\node\\node.exe',
      backendEntry: 'e',
      backendRoot: 'b',
      backendEnvFile: 'c',
      configDir: 'c',
      storageDir: 's',
      logsDir: 'l',
      apiRuntimeLogFile: 'l',
    });
    expect(p).toContain('"');
  });
});
