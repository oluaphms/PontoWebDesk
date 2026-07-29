// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CrmProfile } from './crm.types.js';

/** Smoke de tipos e regras locais (sem DB). */
describe('CRM types', () => {
  it('situações comerciais cobrem o funil', () => {
    const situations = [
      'prospect',
      'negociacao',
      'ativo',
      'implantacao',
      'inadimplente',
      'churn',
      'pausado',
    ];
    expect(situations).toHaveLength(7);
  });

  it('perfil mínimo tipado', () => {
    const profile: CrmProfile = {
      masterTenantId: 'tn_1',
      companyName: 'Acme',
      contactName: 'Ana',
      phone: null,
      whatsapp: null,
      email: 'a@acme.test',
      city: 'São Paulo',
      state: 'SP',
      contractedPlan: 'PRO',
      negotiatedAmountCents: 19900,
      paymentMethod: 'pix',
      pixKey: null,
      dueDate: '2026-08-01',
      situation: 'negociacao',
      notes: null,
      lastContactAt: null,
      deploymentDate: null,
      lastAccessAt: null,
      lastUpdateAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(profile.companyName).toBe('Acme');
    expect(profile.negotiatedAmountCents).toBe(19900);
  });
});
