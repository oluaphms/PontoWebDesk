import { afterEach, describe, expect, it } from 'vitest';
import { fetchHealthJson, HealthServer } from '../src/HealthServer.ts';
import { createTempLayout } from './helpers/tempLayout.js';
import { RuntimeValidator } from '../src/RuntimeValidator.ts';

describe('HealthServer', () => {
  let port = 0;
  let server: HealthServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  async function startServer(validationOk: boolean): Promise<number> {
    const { paths, cleanup } = createTempLayout();
    const validator = new RuntimeValidator(paths, { checkDatabase: false });
    const validation = validationOk ? await validator.validate() : { ok: false, errors: [{ code: 'X', message: 'y' }], warnings: [] };
    port = 30200 + Math.floor(Math.random() * 1000);
    server = new HealthServer({
      port,
      productVersion: '0.1.0-rc2.3.1',
      getValidation: () => validation,
    });
    await server.start();
    cleanup();
    return port;
  }

  it('/api/health/live', async () => {
    const p = await startServer(true);
    const r = await fetchHealthJson(p, '/api/health/live');
    expect(r.status).toBe(200);
    expect((r.body as { status: string }).status).toBe('live');
  });

  it('/api/version', async () => {
    const p = await startServer(true);
    const r = await fetchHealthJson(p, '/api/version');
    expect(r.status).toBe(200);
    expect((r.body as { component: string }).component).toBe('api-runtime');
  });

  it('/api/health/ready 200 quando validação ok', async () => {
    const p = await startServer(true);
    const r = await fetchHealthJson(p, '/api/health/ready');
    expect(r.status).toBe(200);
  });

  it('/api/health/ready 503 quando validação fail', async () => {
    const p = await startServer(false);
    const r = await fetchHealthJson(p, '/api/health/ready');
    expect(r.status).toBe(503);
  });

  it('404 para rota desconhecida', async () => {
    const p = await startServer(true);
    const r = await fetchHealthJson(p, '/unknown');
    expect(r.status).toBe(404);
  });
});
