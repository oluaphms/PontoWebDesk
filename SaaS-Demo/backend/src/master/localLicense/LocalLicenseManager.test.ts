// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { LocalLicenseManager } from './LocalLicenseManager.js';

describe('LocalLicenseManager (offline)', () => {
  it('emite licença com todos os campos e valida offline', async () => {
    const mgr = LocalLicenseManager.createInMemory();
    const machineId = mgr.createMachineId({
      hostname: 'rep-box-01',
      platform: 'win32',
      components: ['disk:ABC', 'cpu:XYZ'],
    });
    const hardwareHash = mgr.createHardwareHash({
      hostname: 'rep-box-01',
      platform: 'win32',
      components: ['disk:ABC', 'cpu:XYZ'],
    });

    const issued = await mgr.issue({
      machineId,
      hardwareHash,
      durationDays: 30,
      plan: 'LOCAL',
    });

    expect(issued.machineId).toBe(machineId);
    expect(issued.licenseKey.startsWith('lloc_')).toBe(true);
    expect(issued.hardwareHash).toBe(hardwareHash);
    expect(issued.activationDate).toBeTruthy();
    expect(issued.expirationDate).toBeTruthy();
    expect(issued.heartbeat).toBe(issued.activationDate);

    const ok = await mgr.validateOffline(machineId, hardwareHash);
    expect(ok.ok).toBe(true);
    expect(ok.status).toBe('valid');
    expect(ok.remainingDays).toBeGreaterThan(0);

    await mgr.heartbeat(machineId);
    const afterHb = await mgr.getByMachineId(machineId);
    expect(Date.parse(afterHb!.heartbeat)).toBeGreaterThanOrEqual(
      Date.parse(issued.heartbeat),
    );
  });

  it('falha offline em hardware mismatch e expiração', async () => {
    const mgr = LocalLicenseManager.createInMemory();
    const machineId = 'mid_test';
    const hash = 'hash_a';
    await mgr.issue({
      machineId,
      hardwareHash: hash,
      expirationDate: '2020-01-01T00:00:00.000Z',
    });

    const mismatch = await mgr.validateOffline(machineId, 'hash_b');
    expect(mismatch.ok).toBe(false);
    expect(mismatch.status).toBe('hardware_mismatch');

    const expired = await mgr.validateOffline(machineId, hash);
    expect(expired.ok).toBe(false);
    expect(expired.status).toBe('expired');
  });

  it('não depende de rede (meta offline)', async () => {
    const mgr = LocalLicenseManager.createInMemory();
    const row = await mgr.issue({
      machineId: 'm1',
      hardwareHash: 'h1',
    });
    expect(row.meta?.offline).toBe(true);
    expect(row.meta?.networkRequired).toBe(false);
  });

  it('renew + revoke (Fase 25)', async () => {
    const mgr = LocalLicenseManager.createInMemory();
    const issued = await mgr.issue({
      machineId: 'm-renew',
      hardwareHash: 'h-renew',
      durationDays: 30,
      meta: { empresa: 'Acme Local' },
    });
    const before = Date.parse(issued.expirationDate!);

    const renewed = await mgr.renew('m-renew', { durationDays: 60 });
    expect(Date.parse(renewed.expirationDate!)).toBeGreaterThan(before);
    expect(mgr.isRevoked(renewed)).toBe(false);

    const revoked = await mgr.revoke('m-renew');
    expect(mgr.isRevoked(revoked)).toBe(true);
    await expect(mgr.renew('m-renew')).rejects.toThrow(/revoked/i);
  });
});
