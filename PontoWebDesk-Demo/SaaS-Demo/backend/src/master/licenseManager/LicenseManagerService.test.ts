// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LicenseManagerService, resolveRules } from './LicenseManagerService.js';

describe('LicenseManagerService', () => {
  it('cria licença por empresa com modo, status e regras', async () => {
    const svc = LicenseManagerService.createInMemory();
    // limpa seed automático via create direto no store novo sem ensureSeed conflict
    const lic = await svc.create({
      tenantId: 'tn_test_1',
      empresa: 'Acme',
      mode: 'HYBRID',
      status: 'Ativa',
      plan: 'PRO',
      durationDays: 45,
    });
    expect(lic.mode).toBe('HYBRID');
    expect(lic.status).toBe('Ativa');
    expect(lic.rules.blockLogin).toBe(false);
    expect(lic.rules.daysRemaining).toBeGreaterThan(40);
    expect(lic.meta?.operationalAuthWired).toBe(false);
  });

  it('bloqueio aplica todas as flags de bloqueio', async () => {
    const svc = LicenseManagerService.createInMemory();
    const lic = await svc.create({
      tenantId: 'tn_block',
      empresa: 'Block Co',
      status: 'Ativa',
      durationDays: 60,
    });
    const blocked = await svc.action(lic.id, 'block', { reason: 'inadimplencia' });
    expect(blocked.status).toBe('Bloqueada');
    expect(blocked.rules.blockLogin).toBe(true);
    expect(blocked.rules.blockApi).toBe(true);
    expect(blocked.rules.blockRep).toBe(true);
    expect(blocked.rules.blockMobile).toBe(true);
    expect(blocked.rules.readOnly).toBe(true);
  });

  it('exclui licença permanentemente', async () => {
    const svc = LicenseManagerService.createInMemory();
    const lic = await svc.create({
      tenantId: 'tn_delete',
      empresa: 'Delete Co',
      status: 'Ativa',
      durationDays: 30,
    });
    const removed = await svc.action(lic.id, 'delete');
    expect(removed.id).toBe(lic.id);
    await expect(svc.get(lic.id)).rejects.toThrow();
  });

  it('aviso de vencimento quando dias restantes baixos', () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const rules = resolveRules('Ativa', soon, {});
    expect(rules.expiryWarning).toBe(true);
    expect(rules.daysRemaining).toBeLessThanOrEqual(5);
  });

  it('1 licença por tenantId', async () => {
    const svc = LicenseManagerService.createInMemory();
    await svc.create({ tenantId: 'tn_unique', empresa: 'A' });
    await expect(svc.create({ tenantId: 'tn_unique', empresa: 'B' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('override manual de regra', async () => {
    const svc = LicenseManagerService.createInMemory();
    const lic = await svc.create({
      tenantId: 'tn_ro',
      status: 'Ativa',
      durationDays: 100,
    });
    const updated = await svc.setRules(lic.id, { readOnly: true, blockRep: true });
    expect(updated.rules.readOnly).toBe(true);
    expect(updated.rules.blockRep).toBe(true);
    expect(updated.rules.blockLogin).toBe(false);
  });

  it('resolveForTenant religa licença legada gravada com CNPJ', async () => {
    const svc = LicenseManagerService.createInMemory();
    const legacy = await svc.create({
      tenantId: '15.048.950/0001-63',
      empresa: 'FL LOCADORA LTDA',
      status: 'Expirada',
      expiresAt: '2026-07-26T00:00:00.000Z',
    });
    expect(await svc.getByTenantId('tn_a871a91fb8914670')).toBeNull();

    const resolved = await svc.resolveForTenant({
      id: 'tn_a871a91fb8914670',
      company: { document: '15.048.950/0001-63' },
    });
    expect(resolved?.id).toBe(legacy.id);
    expect(resolved?.tenantId).toBe('tn_a871a91fb8914670');
    expect(await svc.getByTenantId('tn_a871a91fb8914670')).not.toBeNull();
  });
});
