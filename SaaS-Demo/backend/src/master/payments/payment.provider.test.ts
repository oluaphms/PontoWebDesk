// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { AsaasProvider } from './adapters/AsaasProvider.js';
import { createPaymentProvider } from './createPaymentProvider.js';
import { MasterError } from '../errors.js';

describe('PaymentProvider (Ports & Adapters)', () => {
  it('AsaasProvider: createPix → webhook paid → refund', async () => {
    const provider = new AsaasProvider();
    const pix = await provider.createPix({
      amountCents: 1990,
      description: 'Assinatura PRO',
      externalReference: 'sub_1',
    });
    expect(pix.provider).toBe('asaas');
    expect(pix.status).toBe('pending');
    expect(pix.pixCopyPaste).toBeTruthy();

    const wh = await provider.webhook({
      rawBody: { event: 'PAYMENT_RECEIVED', payment: { id: pix.id } },
    });
    expect(wh.handled).toBe(true);
    expect(wh.payment?.status).toBe('paid');

    const refunded = await provider.refund({ paymentId: pix.id });
    expect(refunded.status).toBe('refunded');

    const got = await provider.getPayment(pix.id);
    expect(got?.status).toBe('refunded');
  });

  it('AsaasProvider: cancel pending', async () => {
    const provider = new AsaasProvider();
    const pix = await provider.createPix({ amountCents: 500 });
    const cancelled = await provider.cancel({ paymentId: pix.id, reason: 'user' });
    expect(cancelled.status).toBe('cancelled');
  });

  it('Stripe e PagSeguro são stubs', async () => {
    const stripe = createPaymentProvider('stripe');
    const pag = createPaymentProvider('pagseguro');
    await expect(stripe.createPix({ amountCents: 100 })).rejects.toBeInstanceOf(MasterError);
    await expect(pag.createPix({ amountCents: 100 })).rejects.toBeInstanceOf(MasterError);
  });
});
