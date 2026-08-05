import { MasterRepositoryRegistry } from '../src/master/registry/MasterRepositoryRegistry.js';
import { createMasterComposition } from '../src/master/registry/createMasterComposition.js';
import { PgLocalLicenseStore } from '../src/master/adapters/postgres/PgLocalLicenseStore.js';
import { PgTenantDeploymentStore } from '../src/master/adapters/postgres/PgTenantDeploymentStore.js';

async function main() {
  const reg = MasterRepositoryRegistry.create('postgres');
  const snap = reg.snapshot();
  console.log('backends', JSON.stringify(snap.backends));
  const memory = Object.entries(snap.backends).filter(([, v]) => v === 'memory');
  console.log('memory_backends', JSON.stringify(memory));

  const local = new PgLocalLicenseStore();
  const mid = `e2e_machine_${Date.now()}`;
  await local.save({
    machineId: mid,
    licenseKey: `lk_${mid}`,
    hardwareHash: 'hh1',
    activationDate: new Date().toISOString(),
    expirationDate: null,
    heartbeat: new Date().toISOString(),
    plan: 'PRO',
  });
  const found = await local.findByMachineId(mid);
  console.log('local_ok', found?.machineId === mid);
  await local.delete(mid);

  const dep = new PgTenantDeploymentStore();
  const did = `dep_e2e_${Date.now()}`;
  const now = new Date().toISOString();
  await dep.save({
    id: did,
    tenantId: 'tn_e2e_tmp',
    empresa: 'E2E',
    mode: 'SAAS',
    currentDeployment: 'cloud',
    lastSyncAt: null,
    status: 'unknown',
    cloud: { enabled: true, region: null, endpoint: null },
    server: { host: null, environment: null, lastSeenAt: null },
    license: { bound: false, tier: null, expiresAt: null },
    version: '2.0.0',
    repAgent: { enabled: false, connected: false, lastHeartbeat: null, version: null },
    realtime: { enabled: false, bridgeActive: false },
    synchronization: { enabled: false, pending: 0, failed: 0, lastSyncAt: null },
    createdAt: now,
    updatedAt: now,
    capabilities: {},
  });
  const d2 = await dep.get(did);
  console.log('deploy_ok', d2?.id === did);
  await dep.delete(did);

  const composition = createMasterComposition(reg);
  console.log('hybrid_backend', snap.backends.hybridSync);
  try {
    composition.hybridSync.syncQueue.enqueue({
      entityType: 'punch',
      entityId: 'x',
      side: 'local',
      payload: {},
    });
    console.log('hybrid_FAIL_should_throw');
  } catch (e) {
    console.log('hybrid_throws_ok', e instanceof Error ? e.message.slice(0, 100) : e);
  }
}

main().catch((err) => {
  console.error('SMOKE_FAIL', err);
  process.exit(1);
});
