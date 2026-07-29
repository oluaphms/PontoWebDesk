// @vitest-environment node

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('apiRouter security', () => {
  let server: Server | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MASTER_API_KEY = 'metrics-master-test-key-with-32-bytes';
    const { app } = await import('../app.js');
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server!.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  }, 30_000);

  afterAll(async () => {
    if (!server) return;
    const activeServer = server;
    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('protege o resumo de métricas com autenticação Master', async () => {
    const anonymous = await fetch(`${baseUrl}/api/metrics/summary`);
    expect(anonymous.status).toBe(401);

    const authorized = await fetch(`${baseUrl}/api/metrics/summary`, {
      headers: { 'x-master-key': process.env.MASTER_API_KEY! },
    });
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({ ok: true });
  });
});
