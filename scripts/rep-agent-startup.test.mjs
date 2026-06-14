// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runStartupHealthCheck } from './rep-agent-startup.mjs';

describe('rep-agent-startup', () => {
  it('falha health check sem saas_url', async () => {
    const prev = process.env.REP_SAAS_URL;
    const prevKey = process.env.API_KEY;
    delete process.env.REP_SAAS_URL;
    delete process.env.API_KEY;
    const result = await runStartupHealthCheck({ saas: '', apiKey: '' });
    expect(result.ok).toBe(false);
    process.env.REP_SAAS_URL = prev;
    process.env.API_KEY = prevKey;
  });
});
