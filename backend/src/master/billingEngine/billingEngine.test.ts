// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DecoupledBillingEngine } from './DecoupledBillingEngine.js';
import { AsaasAdapter } from './adapters/AsaasAdapter.js';
import { PagSeguroAdapter } from './adapters/PagSeguroAdapter.js';
import { StripeAdapter } from './adapters/StripeAdapter.js';

describe('DecoupledBillingEngine', () => {
  it('adapters mock criam invoice, payment, pix, refund e webhook', async () => {
    const engine = DecoupledBillingEngine.createInMemory('asaas');
    expect(engine.getProvider().isExternalReady()).toBe(false);

    const invoice = await engine.createInvoice({
      description: 'Mensalidade PRO',
      amountCents: 19900,
      tenantId: 'tn_1',
    });
    expect(invoice.provider).toBe('asaas');
    expect(invoice.status).toBe('open');

    const pix = await engine.createPix({
      amountCents: 19900,
      description: 'PIX mensalidade',
      invoiceId: invoice.id,
    });
    expect(pix.status).toBe('pending');
    expect(pix.copyPaste).toContain('br.gov.bcb.pix');

    const paid = await engine.markPixPaid(pix.id);
    expect(paid.status).toBe('paid');

    const payments = await engine.listPayments();
    expect(payments.some((p) => p.status === 'paid')).toBe(true);

    const payment = payments.find((p) => p.status === 'paid')!;
    const refund = await engine.createRefund({
      paymentId: payment.id,
      reason: 'test',
    });
    expect(refund.status).toBe('succeeded');

    const snap = await engine.snapshot();
    expect(snap.externalReady).toBe(false);
    expect(snap.persistence).toBe('in_memory');
    expect(snap.adapters.map((a) => a.name).sort()).toEqual(['asaas', 'pagseguro', 'stripe']);
    expect(snap.counts.webhooks).toBeGreaterThan(0);
  });

  it('exclui pagamento pendente e também pago (limpeza Master)', async () => {
    const engine = DecoupledBillingEngine.createInMemory('asaas');
    const pending = await engine.createPayment({
      amountCents: 9900,
      method: 'pix',
      description: 'Para excluir',
    });
    const removed = await engine.deletePayment(pending.id);
    expect(removed.id).toBe(pending.id);
    const remaining = await engine.listPayments();
    expect(remaining.some((p) => p.id === pending.id)).toBe(false);

    const again = await engine.createPayment({
      amountCents: 5000,
      method: 'pix',
      description: 'Pagar e excluir',
    });
    await engine.markPaymentPaid(again.id);
    const removedPaid = await engine.deletePayment(again.id);
    expect(removedPaid.id).toBe(again.id);
    expect(removedPaid.status).toBe('paid');
    const afterPaid = await engine.listPayments();
    expect(afterPaid.some((p) => p.id === again.id)).toBe(false);
  });

  it('AsaasAdapter, PagSeguroAdapter e StripeAdapter são mockados', async () => {
    for (const Adapter of [AsaasAdapter, PagSeguroAdapter, StripeAdapter]) {
      const adapter = new Adapter();
      expect(adapter.isExternalReady()).toBe(false);
      const inv = await adapter.createInvoice({
        description: 'Test',
        amountCents: 1000,
      });
      expect(inv.amountCents).toBe(1000);
      expect(inv.meta?.simulated).toBe(true);
    }
  });
});
