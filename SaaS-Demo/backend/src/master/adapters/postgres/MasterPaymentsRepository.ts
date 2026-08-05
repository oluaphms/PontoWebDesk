/**
 * MasterPaymentsRepository — pagamentos / PIX / refunds / webhooks PostgreSQL.
 */
import type { Payment, PixCharge, Refund, Webhook } from '../../billingEngine/types.js';
import {
  asJson,
  jsonParam,
  masterSql,
  toIso,
  toIsoRequired,
  type MasterSqlQuery,
} from './masterSql.js';

type PaymentRow = {
  id: string;
  provider: string;
  invoice_id: string | null;
  method: string;
  amount_cents: string | number;
  currency: string;
  status: string;
  description: string | null;
  paid_at: Date | string | null;
  cancelled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  meta: unknown;
};

type PixRow = {
  id: string;
  provider: string;
  payment_id: string | null;
  invoice_id: string | null;
  amount_cents: string | number;
  currency: string;
  status: string;
  description: string | null;
  qr_code: string;
  copy_paste: string;
  expires_at: Date | string;
  paid_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  meta: unknown;
};

type RefundRow = {
  id: string;
  provider: string;
  payment_id: string;
  amount_cents: string | number;
  currency: string;
  status: string;
  reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  succeeded_at: Date | string | null;
  meta: unknown;
};

type WebhookRow = {
  id: string;
  provider: string;
  event: string;
  resource_id: string;
  payload: unknown;
  received_at: Date | string;
  processed: boolean;
  message: string | null;
};

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    provider: row.provider as Payment['provider'],
    invoiceId: row.invoice_id,
    method: row.method as Payment['method'],
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status as Payment['status'],
    description: row.description,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    paidAt: toIso(row.paid_at),
    cancelledAt: toIso(row.cancelled_at),
    meta: asJson(row.meta),
  };
}

function mapPix(row: PixRow): PixCharge {
  return {
    id: row.id,
    provider: row.provider as PixCharge['provider'],
    paymentId: row.payment_id,
    invoiceId: row.invoice_id,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status as PixCharge['status'],
    description: row.description,
    qrCode: row.qr_code,
    copyPaste: row.copy_paste,
    expiresAt: toIsoRequired(row.expires_at),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    paidAt: toIso(row.paid_at),
    meta: asJson(row.meta),
  };
}

function mapRefund(row: RefundRow): Refund {
  return {
    id: row.id,
    provider: row.provider as Refund['provider'],
    paymentId: row.payment_id,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status as Refund['status'],
    reason: row.reason,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    succeededAt: toIso(row.succeeded_at),
    meta: asJson(row.meta),
  };
}

function mapWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    provider: row.provider as Webhook['provider'],
    event: row.event as Webhook['event'],
    resourceId: row.resource_id,
    payload: asJson(row.payload),
    receivedAt: toIsoRequired(row.received_at),
    processed: Boolean(row.processed),
    message: row.message,
  };
}

export class MasterPaymentsRepository {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async savePayment(payment: Payment): Promise<Payment> {
    const result = await this.sql<PaymentRow>(
      `INSERT INTO public.master_payments (
         id, provider, invoice_id, method, amount_cents, currency, status, description,
         paid_at, cancelled_at, created_at, updated_at, meta
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,
         $9,$10,$11,$12,$13::jsonb
       )
       ON CONFLICT (id) DO UPDATE SET
         provider = EXCLUDED.provider,
         invoice_id = EXCLUDED.invoice_id,
         method = EXCLUDED.method,
         amount_cents = EXCLUDED.amount_cents,
         currency = EXCLUDED.currency,
         status = EXCLUDED.status,
         description = EXCLUDED.description,
         paid_at = EXCLUDED.paid_at,
         cancelled_at = EXCLUDED.cancelled_at,
         updated_at = EXCLUDED.updated_at,
         meta = EXCLUDED.meta
       RETURNING *`,
      [
        payment.id,
        payment.provider,
        payment.invoiceId,
        payment.method,
        payment.amountCents,
        payment.currency,
        payment.status,
        payment.description,
        payment.paidAt,
        payment.cancelledAt,
        payment.createdAt,
        payment.updatedAt,
        jsonParam(payment.meta ?? {}),
      ],
    );
    return mapPayment(result.rows[0]);
  }

  async getPayment(id: string): Promise<Payment | null> {
    const result = await this.sql<PaymentRow>(
      `SELECT * FROM public.master_payments WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  }

  async listPayments(): Promise<Payment[]> {
    const result = await this.sql<PaymentRow>(
      `SELECT * FROM public.master_payments ORDER BY created_at DESC`,
    );
    return result.rows.map(mapPayment);
  }

  async deletePayment(id: string): Promise<boolean> {
    // Limpa PIX vinculados antes do pagamento (FK lógica).
    await this.sql(`DELETE FROM public.master_pix_charges WHERE payment_id = $1`, [id]);
    const result = await this.sql(
      `DELETE FROM public.master_payments WHERE id = $1 RETURNING id`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deletePix(id: string): Promise<boolean> {
    const result = await this.sql(
      `DELETE FROM public.master_pix_charges WHERE id = $1 RETURNING id`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async savePix(pix: PixCharge): Promise<PixCharge> {
    const result = await this.sql<PixRow>(
      `INSERT INTO public.master_pix_charges (
         id, provider, payment_id, invoice_id, amount_cents, currency, status, description,
         qr_code, copy_paste, expires_at, paid_at, created_at, updated_at, meta
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,
         $9,$10,$11,$12,$13,$14,$15::jsonb
       )
       ON CONFLICT (id) DO UPDATE SET
         provider = EXCLUDED.provider,
         payment_id = EXCLUDED.payment_id,
         invoice_id = EXCLUDED.invoice_id,
         amount_cents = EXCLUDED.amount_cents,
         currency = EXCLUDED.currency,
         status = EXCLUDED.status,
         description = EXCLUDED.description,
         qr_code = EXCLUDED.qr_code,
         copy_paste = EXCLUDED.copy_paste,
         expires_at = EXCLUDED.expires_at,
         paid_at = EXCLUDED.paid_at,
         updated_at = EXCLUDED.updated_at,
         meta = EXCLUDED.meta
       RETURNING *`,
      [
        pix.id,
        pix.provider,
        pix.paymentId,
        pix.invoiceId,
        pix.amountCents,
        pix.currency,
        pix.status,
        pix.description,
        pix.qrCode,
        pix.copyPaste,
        pix.expiresAt,
        pix.paidAt,
        pix.createdAt,
        pix.updatedAt,
        jsonParam(pix.meta ?? {}),
      ],
    );
    return mapPix(result.rows[0]);
  }

  async listPix(): Promise<PixCharge[]> {
    const result = await this.sql<PixRow>(
      `SELECT * FROM public.master_pix_charges ORDER BY created_at DESC`,
    );
    return result.rows.map(mapPix);
  }

  async saveRefund(refund: Refund): Promise<Refund> {
    const result = await this.sql<RefundRow>(
      `INSERT INTO public.master_refunds (
         id, provider, payment_id, amount_cents, currency, status, reason,
         created_at, updated_at, succeeded_at, meta
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11::jsonb
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         reason = EXCLUDED.reason,
         updated_at = EXCLUDED.updated_at,
         succeeded_at = EXCLUDED.succeeded_at,
         meta = EXCLUDED.meta
       RETURNING *`,
      [
        refund.id,
        refund.provider,
        refund.paymentId,
        refund.amountCents,
        refund.currency,
        refund.status,
        refund.reason,
        refund.createdAt,
        refund.updatedAt,
        refund.succeededAt,
        jsonParam(refund.meta ?? {}),
      ],
    );
    return mapRefund(result.rows[0]);
  }

  async listRefunds(): Promise<Refund[]> {
    const result = await this.sql<RefundRow>(
      `SELECT * FROM public.master_refunds ORDER BY created_at DESC`,
    );
    return result.rows.map(mapRefund);
  }

  async saveWebhook(webhook: Webhook): Promise<Webhook> {
    const result = await this.sql<WebhookRow>(
      `INSERT INTO public.master_billing_webhooks (
         id, provider, event, resource_id, payload, received_at, processed, message
       ) VALUES (
         $1,$2,$3,$4,$5::jsonb,$6,$7,$8
       )
       ON CONFLICT (id) DO UPDATE SET
         processed = EXCLUDED.processed,
         message = EXCLUDED.message
       RETURNING *`,
      [
        webhook.id,
        webhook.provider,
        webhook.event,
        webhook.resourceId,
        jsonParam(webhook.payload),
        webhook.receivedAt,
        webhook.processed,
        webhook.message,
      ],
    );
    return mapWebhook(result.rows[0]);
  }

  async listWebhooks(): Promise<Webhook[]> {
    const result = await this.sql<WebhookRow>(
      `SELECT * FROM public.master_billing_webhooks ORDER BY received_at DESC`,
    );
    return result.rows.map(mapWebhook);
  }
}
