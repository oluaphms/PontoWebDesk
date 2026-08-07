import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ServiceValidator } from '../src/ServiceValidator.js';
import { mockApiServicePaths } from './helpers/mockApiServicePaths.js';
import * as apiRuntime from '@pontowebdesk/api-runtime';

describe('ServiceValidator', () => {
  it('falha se serviço não instalado', async () => {
    const sc = () => ({ exitCode: 1, stdout: '1060', stderr: '' });
    const v = await new ServiceValidator(sc, mockApiServicePaths(), 3011, {
      checkPort: false,
    }).validate();
    expect(v.ok).toBe(false);
    expect(v.checks.service_installed).toBe(false);
  });

  it('valida health endpoints quando mockados', async () => {
    const sc = (args: string[]) =>
      args[0] === 'query'
        ? { exitCode: 0, stdout: 'STATE : 4 RUNNING', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };

    vi.spyOn(apiRuntime, 'fetchHealthJson').mockResolvedValue({ status: 200, body: {} });

    const v = await new ServiceValidator(sc, mockApiServicePaths(), 3011, {
      checkPort: false,
    }).validate();
    expect(v.checks.health__api_health_live).toBe(true);
    expect(v.checks.health__api_health_ready).toBe(true);
    vi.restoreAllMocks();
  });
});
