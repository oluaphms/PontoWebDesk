// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TenantDeploymentManager, defaultsForMode } from './TenantDeploymentManager.js';

describe('TenantDeploymentManager', () => {
  it('cria deployment por tenant com modo SAAS/LOCAL/HYBRID', async () => {
    const mgr = TenantDeploymentManager.createInMemory();
    const saas = await mgr.create({
      tenantId: 'tn_a',
      empresa: 'A',
      mode: 'SAAS',
    });
    expect(saas.mode).toBe('SAAS');
    expect(saas.cloud.enabled).toBe(true);
    expect(saas.currentDeployment).toBe('cloud-primary');
    expect(saas.meta?.platformRuntimeWired).toBe(false);

    const local = await mgr.create({ tenantId: 'tn_b', mode: 'LOCAL' });
    expect(local.cloud.enabled).toBe(false);
    expect(local.synchronization.enabled).toBe(false);

    const hybrid = await mgr.create({ tenantId: 'tn_c', mode: 'HYBRID' });
    expect(hybrid.synchronization.enabled).toBe(true);
    expect(hybrid.realtime.enabled).toBe(true);
  });

  it('1 deployment por tenantId', async () => {
    const mgr = TenantDeploymentManager.createInMemory();
    await mgr.create({ tenantId: 'tn_x' });
    await expect(mgr.create({ tenantId: 'tn_x' })).rejects.toThrow(/already exists/);
  });

  it('simulate_sync atualiza lastSyncAt e status', async () => {
    const mgr = TenantDeploymentManager.createInMemory();
    const row = await mgr.create({ tenantId: 'tn_sync', mode: 'HYBRID' });
    const synced = await mgr.action(row.id, 'simulate_sync');
    expect(synced.status).toBe('healthy');
    expect(synced.lastSyncAt).toBeTruthy();
    expect(synced.synchronization.pending).toBe(0);
  });

  it('defaultsForMode cobre os 3 modos', () => {
    expect(defaultsForMode('SAAS').capabilities.useRemoteApi).toBe(true);
    expect(defaultsForMode('LOCAL').capabilities.preferLocalOps).toBe(true);
    expect(defaultsForMode('HYBRID').capabilities.enableCloudSync).toBe(true);
  });

  it('list/get não recriam demos automaticamente', async () => {
    const mgr = TenantDeploymentManager.createInMemory();
    expect(await mgr.list()).toEqual([]);
    await expect(mgr.get('missing')).rejects.toThrow();
  });

  it('ensureSeed com force cria demos uma vez', async () => {
    const mgr = TenantDeploymentManager.createInMemory();
    await mgr.ensureSeed({ force: true });
    const rows = await mgr.list();
    expect(rows.length).toBe(4);
  });
});
