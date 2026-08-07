import { describe, expect, it } from 'vitest';
import { ServiceController } from '../src/ServiceController.js';
import { parseScQueryState } from '../src/scExec.js';

describe('ServiceController edge', () => {
  it('start falha se não instalado', () => {
    const sc = () => ({ exitCode: 1, stdout: '1060', stderr: '' });
    expect(new ServiceController(sc).start().ok).toBe(false);
  });

  it('parseScQueryState null', () => {
    expect(parseScQueryState('no state here')).toBeNull();
  });
});

describe('ServiceController', () => {
  it('query NOT_INSTALLED', () => {
    const sc = () => ({ exitCode: 1, stdout: '1060', stderr: '' });
    expect(new ServiceController(sc).query().state).toBe('NOT_INSTALLED');
  });

  it('query RUNNING', () => {
    const sc = (args: string[]) =>
      args[0] === 'query'
        ? { exitCode: 0, stdout: 'STATE : 4 RUNNING', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };
    expect(new ServiceController(sc).query().state).toBe('RUNNING');
  });

  it('start when already running', () => {
    const sc = (args: string[]) =>
      args[0] === 'query'
        ? { exitCode: 0, stdout: 'RUNNING', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };
    const r = new ServiceController(sc).start();
    expect(r.ok).toBe(true);
    expect(r.message).toBe('ALREADY_RUNNING');
  });

  it('stop when stopped', () => {
    const sc = (args: string[]) =>
      args[0] === 'query'
        ? { exitCode: 0, stdout: 'STOPPED', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };
    const r = new ServiceController(sc).stop();
    expect(r.message).toBe('ALREADY_STOPPED');
  });

  it('restart invoca stop e start', () => {
    const calls: string[] = [];
    const sc = (args: string[]) => {
      calls.push(args[0] ?? '');
      if (args[0] === 'query') {
        return calls.filter((c) => c === 'query').length > 2
          ? { exitCode: 0, stdout: 'RUNNING', stderr: '' }
          : { exitCode: 0, stdout: 'STOPPED', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const r = new ServiceController(sc).restart();
    expect(r.ok).toBe(true);
  });
});
