import { describe, expect, it } from 'vitest';
import { ServiceRecovery } from '../src/ServiceRecovery.js';
import { RECOVERY_RESET_SECONDS } from '../src/ServiceConfig.js';

describe('ServiceRecovery', () => {
  it('configure envia sc failure', () => {
    const calls: string[][] = [];
    const sc = (args: string[]) => {
      calls.push([...args]);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const r = new ServiceRecovery(sc).configure();
    expect(r.ok).toBe(true);
    expect(calls[0]?.[0]).toBe('failure');
    expect(calls[0]?.some((a) => a.includes(String(RECOVERY_RESET_SECONDS)))).toBe(true);
  });

  it('buildFailureCommand inclui restart delays', () => {
    const cmd = new ServiceRecovery(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })).buildFailureCommand();
    expect(cmd.join(' ')).toContain('restart/5000');
    expect(cmd.join(' ')).toContain('restart/30000');
    expect(cmd.join(' ')).toContain('restart/60000');
  });
});
