// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createMasterServices } from './createMasterServices.js';

describe('Master panel architecture', () => {
  it('fluxo in-memory: customer → tenant → license → activate → block → unlock', async () => {
    const master = createMasterServices();

    const customer = await master.customers.create({
      name: 'Acme Ltda',
      email: 'admin@acme.test',
    });
    const tenant = await master.tenants.create({
      customerId: customer.id,
      name: 'Acme Operação',
      deploymentMode: 'SAAS',
    });
    expect(tenant.status).toBe('draft');

    await master.deploymentControl.setMode(tenant.id, 'HYBRID');
    expect(await master.deploymentControl.getMode(tenant.id)).toBe('HYBRID');

    const sub = await master.subscriptions.create({
      tenantId: tenant.id,
      planCode: 'standard',
    });
    expect(sub.status).toBe('trialing');

    const invoice = await master.billing.createInvoice({
      customerId: customer.id,
      tenantId: tenant.id,
      subscriptionId: sub.id,
      amountCents: 9900,
    });
    expect(master.billing.isChargingEnabled()).toBe(false);
    expect(invoice.status).toBe('draft');

    const license = await master.licenses.generate({
      tenantId: tenant.id,
      tier: 'standard',
      plan: 'Standard',
    });
    expect(license.key.startsWith('lic_')).toBe(true);

    const activated = await master.activation.activate({
      tenantId: tenant.id,
      licenseId: license.id,
    });
    expect(activated.tenant.status).toBe('active');

    const blocked = await master.block.block({
      tenantId: tenant.id,
      reason: 'inadimplencia_teste',
    });
    expect(blocked.tenant.status).toBe('blocked');

    const unlocked = await master.unlock.unlock({ tenantId: tenant.id });
    expect(unlocked.tenant.status).toBe('active');
    expect(unlocked.block.unlockedAt).toBeTruthy();
  });
});
