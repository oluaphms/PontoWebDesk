// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { WebhookService } from './WebhookService.js';
import { PAYMENT_WEBHOOK_EVENTS } from './webhook.types.js';
import { MasterError } from '../errors.js';

describe('WebhookService', () => {
  it('recebe os 5 eventos canônicos', async () => {
    const svc = new WebhookService();
    expect(svc.getSupportedEvents()).toEqual([...PAYMENT_WEBHOOK_EVENTS]);

    for (const event of PAYMENT_WEBHOOK_EVENTS) {
      const receipt = await svc.receive({
        event,
        paymentId: `pay_${event}`,
        amountCents: 1000,
      });
      expect(receipt.status).toBe('accepted');
      expect(receipt.handled).toBe(true);
      expect(receipt.event).toBe(event);
      expect(receipt.message).toBe('structure_only_no_gateway');
    }
    expect((await svc.listReceipts()).length).toBe(5);
  });

  it('normaliza aliases sem integrar gateway', async () => {
    const svc = new WebhookService();
    const r = await svc.receive({ event: 'PAYMENT_RECEIVED', paymentId: 'x' });
    expect(r.event).toBe('PIX_RECEIVED');
  });

  it('rejeita evento desconhecido', async () => {
    const svc = new WebhookService();
    await expect(svc.receive({ event: 'UNKNOWN_EVENT' })).rejects.toBeInstanceOf(MasterError);
  });
});
