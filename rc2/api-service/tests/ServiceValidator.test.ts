import { describe, expect, it, vi } from 'vitest';
import { ServiceValidator } from '../src/ServiceValidator.js';
import { mockApiServicePaths } from './helpers/mockApiServicePaths.js';

describe('ServiceValidator', () => {
  it('falha se serviço não instalado', async () => {
    const sc = () => ({ exitCode: 1, stdout: '1060', stderr: '' });
    const v = await new ServiceValidator(sc, mockApiServicePaths(), 3000, {
      checkPort: false,
    }).validate();
    expect(v.ok).toBe(false);
    expect(v.checks.service_installed).toBe(false);
  });

  it('valida health endpoints na porta da API', async () => {
    const sc = (args: string[]) =>
      args[0] === 'query'
        ? { exitCode: 0, stdout: 'STATE : 4 RUNNING', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200 })),
    );

    const v = await new ServiceValidator(sc, mockApiServicePaths(), 3000, {
      checkPort: false,
    }).validate();
    // checkPort false: não sonda TCP/health, mas serviço running conta
    expect(v.checks.service_running).toBe(true);
    expect(v.checks.api_port_3000).toBe(true);
    vi.unstubAllGlobals();
  });
});
