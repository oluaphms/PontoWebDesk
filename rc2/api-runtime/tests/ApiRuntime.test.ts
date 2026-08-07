import { describe, expect, it } from 'vitest';
import { ApiRuntime } from '../src/ApiRuntime.ts';
import { createTempLayout } from './helpers/tempLayout.js';

describe('ApiRuntime', () => {
  it('dryRun não inicia backend', async () => {
    const { paths, cleanup } = createTempLayout();
    try {
      const rt = new ApiRuntime({ paths, dryRun: true, healthPort: 30301 });
      const status = await rt.start();
      expect(status.running).toBe(false);
      expect(status.validation.ok).toBe(true);
      await rt.stop();
    } finally {
      cleanup();
    }
  });

  it('validateOnly via validate()', async () => {
    const { paths, cleanup } = createTempLayout();
    try {
      const v = await new ApiRuntime({ paths }).validate();
      expect(v.ok).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe('integration hooks', () => {
  it('exporta API_RUNTIME_SERVICE_NAME', async () => {
    const { API_RUNTIME_SERVICE_NAME } = await import('../src/integration/hooks.ts');
    expect(API_RUNTIME_SERVICE_NAME).toBe('PontoWebDeskApi');
  });
});
