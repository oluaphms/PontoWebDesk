// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MasterTenantsService } from './MasterTenantsService.js';

describe('MasterTenantsService', () => {
  it('cria, edita e aplica ações de status', async () => {
    const svc = MasterTenantsService.createInMemory();
    const created = await svc.create({
      company: { name: 'Acme Ltda', document: '12.345.678/0001-90' },
      admin: { name: 'Admin', email: 'admin@acme.test' },
      domain: 'acme.test',
      plan: 'PRO',
      mode: 'SAAS',
      status: 'active',
    });
    expect(created.company.name).toBe('Acme Ltda');
    expect(created.company.document).toBe('12.345.678/0001-90');
    expect(created.status).toBe('active');

    const updated = await svc.update(created.id, {
      company: { name: 'Acme Atualizada' },
      plan: 'ENTERPRISE',
    });
    expect(updated.company.name).toBe('Acme Atualizada');
    expect(updated.plan).toBe('ENTERPRISE');
    expect(updated.status).toBe('active');

    const blocked = await svc.applyAction(created.id, 'block', { reason: 'inadimplencia' });
    expect(blocked.status).toBe('blocked');

    const unblocked = await svc.applyAction(created.id, 'unblock');
    expect(unblocked.status).toBe('active');

    const suspended = await svc.applyAction(created.id, 'suspend');
    expect(suspended.status).toBe('suspended');

    const cancelled = await svc.applyAction(created.id, 'cancel');
    expect(cancelled.status).toBe('cancelled');
  });

  it('Fase 6.1 — ciclo de licença ACTIVE/TRIAL/SUSPENDED/BLOCKED/CANCELLED', async () => {
    const svc = MasterTenantsService.createInMemory();
    const created = await svc.create({
      company: { name: 'Trial Co', document: '33.333.333/0001-33' },
      admin: { name: 'T', email: 't@trial.test' },
      domain: 'trial.co',
      plan: 'TRIAL',
      mode: 'SAAS',
      status: 'draft',
    });

    const trial = await svc.applyAction(created.id, 'start_trial');
    expect(trial.status).toBe('trial');

    const active = await svc.applyAction(created.id, 'activate');
    expect(active.status).toBe('active');

    const suspended = await svc.applyAction(created.id, 'suspend');
    expect(suspended.status).toBe('suspended');

    const unblocked = await svc.applyAction(created.id, 'unblock');
    expect(unblocked.status).toBe('active');

    const blocked = await svc.applyAction(created.id, 'block');
    expect(blocked.status).toBe('blocked');

    const cancelled = await svc.applyAction(created.id, 'cancel');
    expect(cancelled.status).toBe('cancelled');

    await expect(svc.applyAction(created.id, 'start_trial')).rejects.toThrow(/cancelled/i);
  });

  it('aceita filtro de status em UPPERCASE (ACTIVE)', async () => {
    const svc = MasterTenantsService.createInMemory();
    await svc.create({
      company: { name: 'Upper', document: '44.444.444/0001-44' },
      admin: { name: 'U', email: 'u@u.test' },
      domain: 'upper.test',
      plan: 'PRO',
      mode: 'SAAS',
      status: 'active',
    });
    const rows = await svc.list({ status: 'ACTIVE' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('active');
  });

  it('filtra por pesquisa e status', async () => {
    const svc = MasterTenantsService.createInMemory();
    await svc.create({
      company: { name: 'Alpha', document: '11.111.111/0001-11' },
      admin: { name: 'A', email: 'a@a.test' },
      domain: 'alpha.test',
      plan: 'STARTER',
      mode: 'LOCAL',
      status: 'active',
    });
    await svc.create({
      company: { name: 'Beta', document: '22.222.222/0001-22' },
      admin: { name: 'B', email: 'b@b.test' },
      domain: 'beta.test',
      plan: 'PRO',
      mode: 'HYBRID',
      status: 'blocked',
    });

    const byQ = await svc.list({ q: 'alpha' });
    expect(byQ).toHaveLength(1);
    expect(byQ[0]?.company.name).toBe('Alpha');

    const byStatus = await svc.list({ status: 'blocked' });
    expect(byStatus).toHaveLength(1);
    expect(byStatus[0]?.company.name).toBe('Beta');
  });
});
