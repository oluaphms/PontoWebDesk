/**
 * Service frontend — Billing Engine Master (InMemory).
 */
import * as api from '../api/billingApi';

export const MasterBillingService = {
  snapshot: api.fetchBillingSnapshot,
  setProvider: api.setBillingProvider,
  listInvoices: api.fetchInvoices,
  createInvoice: api.createInvoice,
  invoiceAction: api.runInvoiceAction,
  listPayments: api.fetchPayments,
  createPayment: api.createPayment,
  paymentAction: api.runPaymentAction,
  listPix: api.fetchPixCharges,
  createPix: api.createPixCharge,
  pixAction: api.runPixAction,
  formatMoney: api.formatMoney,
  formatDate: api.formatBillingDate,
};

export type {
  Invoice,
  Payment,
  PixCharge,
  Refund,
  BillingProviderName,
  BillingSnapshot,
} from '../api/billingApi';

export default MasterBillingService;
