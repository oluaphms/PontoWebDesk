/**
 * MasterInvoicesRepository — faturas PostgreSQL do Billing Engine.
 */
import type { Invoice } from '../../billingEngine/types.js';
import {
  asJson,
  jsonParam,
  masterSql,
  toIso,
  toIsoRequired,
  type MasterSqlQuery,
} from './masterSql.js';

type InvoiceRow = {
  id: string;
  provider: string;
  tenant_id: string | null;
  customer_id: string | null;
  description: string;
  amount_cents: string | number;
  currency: string;
  status: string;
  due_at: Date | string | null;
  paid_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  meta: unknown;
};

function mapRow(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    provider: row.provider as Invoice['provider'],
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    description: row.description,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status as Invoice['status'],
    dueAt: toIso(row.due_at),
    paidAt: toIso(row.paid_at),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    meta: asJson(row.meta),
  };
}

export class MasterInvoicesRepository {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async save(invoice: Invoice): Promise<Invoice> {
    const result = await this.sql<InvoiceRow>(
      `INSERT INTO public.master_invoices (
         id, provider, tenant_id, customer_id, description, amount_cents, currency,
         status, due_at, paid_at, created_at, updated_at, meta
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11,$12,$13::jsonb
       )
       ON CONFLICT (id) DO UPDATE SET
         provider = EXCLUDED.provider,
         tenant_id = EXCLUDED.tenant_id,
         customer_id = EXCLUDED.customer_id,
         description = EXCLUDED.description,
         amount_cents = EXCLUDED.amount_cents,
         currency = EXCLUDED.currency,
         status = EXCLUDED.status,
         due_at = EXCLUDED.due_at,
         paid_at = EXCLUDED.paid_at,
         updated_at = EXCLUDED.updated_at,
         meta = EXCLUDED.meta
       RETURNING *`,
      [
        invoice.id,
        invoice.provider,
        invoice.tenantId,
        invoice.customerId,
        invoice.description,
        invoice.amountCents,
        invoice.currency,
        invoice.status,
        invoice.dueAt,
        invoice.paidAt,
        invoice.createdAt,
        invoice.updatedAt,
        jsonParam(invoice.meta ?? {}),
      ],
    );
    return mapRow(result.rows[0]);
  }

  async get(id: string): Promise<Invoice | null> {
    const result = await this.sql<InvoiceRow>(
      `SELECT * FROM public.master_invoices WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async list(): Promise<Invoice[]> {
    const result = await this.sql<InvoiceRow>(
      `SELECT * FROM public.master_invoices ORDER BY created_at DESC`,
    );
    return result.rows.map(mapRow);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.sql(`DELETE FROM public.master_invoices WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
