import fs from 'node:fs';

const p = 'backend/src/master/api/services/index.ts';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('  async getSubscriptions() {');
const end = s.indexOf('  async getDeployments() {');
if (start < 0 || end < 0) {
  console.error('markers not found', start, end);
  process.exit(1);
}
const replacement = `  async getSubscriptions() {
    const [rows, tenants] = await Promise.all([
      this.dashboard().subscriptions.list(),
      this.tenants().list(),
    ]);
    const { MasterSubscriptionsService } = await import(
      '../../subscriptions/MasterSubscriptionsService.js'
    );
    const helper = new MasterSubscriptionsService();
    const nameByTenant = new Map(tenants.map((t) => [t.id, t.company.name] as const));
    const subscriptions = rows.map((s) =>
      helper.toCommercialView(s, nameByTenant.get(s.tenantId) ?? s.tenantId),
    );
    return {
      ok: true,
      subscriptions,
      count: subscriptions.length,
      gatewayIntegrated: false,
      paymentIntegrated: false,
      note: 'architecture_only_no_payment',
    };
  },

  async getPayments() {
    const { SubscriptionFinanceService } = await import(
      '../../subscriptionFinance/SubscriptionFinanceService.js'
    );
    const finance = new SubscriptionFinanceService();
    const entries = await finance.listAllPayments(5000);
    const payments = entries
      .filter((e) => e.status === 'PAID')
      .map((e) => ({
        id: e.id,
        status: 'paid',
        amountCents: e.amountCents || 0,
        currency: e.currency || 'BRL',
        paidAt: e.paidAt,
        createdAt: e.createdAt,
        tenantId: e.tenantId,
        subscriptionId: e.subscriptionId,
        description: e.description,
      }));
    return {
      ok: true,
      provider: 'subscription_finance',
      payments,
      refunds: [],
      gateway: this.dashboard().gateway.list(),
      count: payments.length,
      persistence: masterPersistenceLabel(),
      note: 'SoT: master_subscription_finance_entries (PAID)',
    };
  },

`;
s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(p, s);
console.log('patched', p);
