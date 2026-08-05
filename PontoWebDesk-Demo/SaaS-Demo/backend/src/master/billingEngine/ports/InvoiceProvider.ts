import type {
  BillingProviderName,
  CreateInvoiceInput,
  Invoice,
} from '../types.js';

/** Port — faturamento (sem HTTP externo nesta fase). */
export interface InvoiceProvider {
  readonly name: BillingProviderName;
  createInvoice(input: CreateInvoiceInput): Promise<Invoice>;
  getInvoice(id: string): Promise<Invoice | null>;
  listInvoices(): Promise<Invoice[]>;
  markInvoicePaid(id: string): Promise<Invoice>;
  voidInvoice(id: string): Promise<Invoice>;
  deleteInvoice(id: string): Promise<Invoice>;
}
