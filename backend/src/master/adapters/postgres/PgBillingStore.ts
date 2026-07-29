/**
 * PgBillingStore — store do Billing Engine com write-through PostgreSQL confirmado.
 * Mutações enfileiram persist(); flushPersists() aguarda confirmação no banco.
 */
import { InMemoryBillingStore } from '../../billingEngine/adapters/InMemoryBillingStore.js';
import type { Invoice, Payment, PixCharge, Refund, Webhook } from '../../billingEngine/types.js';
import { MasterInvoicesRepository } from './MasterInvoicesRepository.js';
import { MasterPaymentsRepository } from './MasterPaymentsRepository.js';
import type { MasterSqlQuery } from './masterSql.js';
import { masterSql } from './masterSql.js';

type FlushableMapOpts<T extends { id: string }> = {
  silent: () => boolean;
  track: (p: Promise<unknown>) => void;
  onDelete?: (id: string) => Promise<unknown>;
};

function createWriteThroughMap<T extends { id: string }>(
  persist: (row: T) => Promise<unknown>,
  opts: FlushableMapOpts<T>,
): Map<string, T> {
  const inner = new Map<string, T>();
  const originalSet = inner.set.bind(inner);
  const originalDelete = inner.delete.bind(inner);
  inner.set = ((key: string, value: T) => {
    originalSet(key, value);
    if (!opts.silent()) {
      opts.track(persist(value));
    }
    return inner;
  }) as Map<string, T>['set'];
  inner.delete = ((key: string) => {
    const ok = originalDelete(key);
    if (ok && !opts.silent() && opts.onDelete) {
      opts.track(opts.onDelete(key));
    }
    return ok;
  }) as Map<string, T>['delete'];
  return inner;
}

/**
 * Extende InMemoryBillingStore com persistência PostgreSQL confirmável.
 */
export class PgBillingStore extends InMemoryBillingStore {
  override readonly persistence = 'postgres' as const;
  private readonly invoicesRepo: MasterInvoicesRepository;
  private readonly paymentsRepo: MasterPaymentsRepository;
  private hydrated = false;
  private silentHydrate = false;
  private pending: Promise<unknown>[] = [];

  constructor(sql: MasterSqlQuery = masterSql) {
    super();
    this.invoicesRepo = new MasterInvoicesRepository(sql);
    this.paymentsRepo = new MasterPaymentsRepository(sql);
    const silent = () => this.silentHydrate;
    const track = (p: Promise<unknown>) => {
      this.pending.push(p);
    };

    this.invoices = createWriteThroughMap((row) => this.invoicesRepo.save(row), {
      silent,
      track,
      onDelete: (id) => this.invoicesRepo.delete(id),
    });
    this.payments = createWriteThroughMap((row) => this.paymentsRepo.savePayment(row), {
      silent,
      track,
      onDelete: (id) => this.paymentsRepo.deletePayment(id),
    });
    this.pixCharges = createWriteThroughMap((row) => this.paymentsRepo.savePix(row), {
      silent,
      track,
      onDelete: (id) => this.paymentsRepo.deletePix(id),
    });
    this.refunds = createWriteThroughMap((row) => this.paymentsRepo.saveRefund(row), {
      silent,
      track,
    });

    const webhookTarget: Webhook[] = [];
    this.webhooks = new Proxy(webhookTarget, {
      get: (target, prop, receiver) => {
        if (prop === 'unshift') {
          return (...items: Webhook[]) => {
            const n = Array.prototype.unshift.apply(target, items);
            if (!this.silentHydrate) {
              for (const item of items) {
                track(this.paymentsRepo.saveWebhook(item));
              }
            }
            return n;
          };
        }
        const val = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      },
      set: (target, prop, value) => Reflect.set(target, prop, value),
    });
  }

  /** Aguarda todas as persistências pendentes — falha se o banco rejeitar. */
  async flushPersists(): Promise<void> {
    const batch = this.pending.splice(0, this.pending.length);
    if (batch.length === 0) return;
    await Promise.all(batch);
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.silentHydrate = true;
    try {
      const [invoices, payments, pix, refunds, webhooks] = await Promise.all([
        this.invoicesRepo.list(),
        this.paymentsRepo.listPayments(),
        this.paymentsRepo.listPix(),
        this.paymentsRepo.listRefunds(),
        this.paymentsRepo.listWebhooks(),
      ]);
      this.invoices.clear();
      this.payments.clear();
      this.pixCharges.clear();
      this.refunds.clear();
      this.webhooks.length = 0;
      this.pending.length = 0;
      for (const inv of invoices) this.invoices.set(inv.id, inv);
      for (const pay of payments) this.payments.set(pay.id, pay);
      for (const p of pix) this.pixCharges.set(p.id, p);
      for (const r of refunds) this.refunds.set(r.id, r);
      this.webhooks.push(...webhooks);
      this.pending.length = 0;
      this.hydrated = true;
    } finally {
      this.silentHydrate = false;
    }
  }
}

/** Confirma write-through quando o store é PgBillingStore. */
export async function confirmBillingPersist(
  store: InMemoryBillingStore,
): Promise<void> {
  if (store instanceof PgBillingStore) {
    await store.flushPersists();
  }
}
