import type { ScExecResult, ScExecutor } from '../../src/scExec.js';

export function createMockSc(handler: (args: string[]) => ScExecResult): ScExecutor {
  return handler;
}

export function recordingSc(): { sc: ScExecutor; calls: string[][] } {
  const calls: string[][] = [];
  const sc: ScExecutor = (args) => {
    calls.push([...args]);
    if (args[0] === 'query') {
      return { exitCode: 0, stdout: 'STATE              : 4  RUNNING', stderr: '' };
    }
    return { exitCode: 0, stdout: 'OK', stderr: '' };
  };
  return { sc, calls };
}
