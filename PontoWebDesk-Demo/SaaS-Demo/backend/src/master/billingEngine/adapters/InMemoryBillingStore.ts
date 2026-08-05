/**
 * Store InMemory compartilhado pelos adapters mock.
 * Sem DB / sem HTTP.
 * Mapas não-readonly para permitir write-through PostgreSQL (PgBillingStore).
 */
import type { Invoice, Payment, PixCharge, Refund, Webhook } from '../types.js';

export class InMemoryBillingStore {
  /** Identificador do backend — PgBillingStore sobrescreve para 'postgres'. */
  readonly persistence: 'memory' | 'postgres' = 'memory';
  invoices: Map<string, Invoice> = new Map();
  payments: Map<string, Payment> = new Map();
  pixCharges: Map<string, PixCharge> = new Map();
  refunds: Map<string, Refund> = new Map();
  webhooks: Webhook[] = [];

  clear(): void {
    this.invoices.clear();
    this.payments.clear();
    this.pixCharges.clear();
    this.refunds.clear();
    this.webhooks.length = 0;
  }
}
