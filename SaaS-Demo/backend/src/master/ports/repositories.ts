/**
 * Ports (repositórios) do Painel Master — contratos sem implementação de DB.
 */
import type {
  MasterActivationRecord,
  MasterBlockRecord,
  MasterCustomer,
  MasterId,
  MasterInvoice,
  MasterLicenseRecord,
  MasterSubscription,
  MasterTenant,
} from '../types.js';

export interface CustomerRepository {
  save(customer: MasterCustomer): Promise<MasterCustomer>;
  findById(id: MasterId): Promise<MasterCustomer | null>;
  findByEmail(email: string): Promise<MasterCustomer | null>;
  list(): Promise<MasterCustomer[]>;
  delete(id: MasterId): Promise<boolean>;
}

export interface TenantRepository {
  save(tenant: MasterTenant): Promise<MasterTenant>;
  findById(id: MasterId): Promise<MasterTenant | null>;
  findBySlug(slug: string): Promise<MasterTenant | null>;
  listByCustomer(customerId: MasterId): Promise<MasterTenant[]>;
  list(): Promise<MasterTenant[]>;
  delete(id: MasterId): Promise<boolean>;
}

export interface SubscriptionRepository {
  save(sub: MasterSubscription): Promise<MasterSubscription>;
  findById(id: MasterId): Promise<MasterSubscription | null>;
  listByTenant(tenantId: MasterId): Promise<MasterSubscription[]>;
  listByCustomer(customerId: MasterId): Promise<MasterSubscription[]>;
  list(): Promise<MasterSubscription[]>;
}

export interface BillingRepository {
  saveInvoice(invoice: MasterInvoice): Promise<MasterInvoice>;
  findInvoiceById(id: MasterId): Promise<MasterInvoice | null>;
  listByCustomer(customerId: MasterId): Promise<MasterInvoice[]>;
  list(): Promise<MasterInvoice[]>;
}

export interface LicenseRecordRepository {
  save(record: MasterLicenseRecord): Promise<MasterLicenseRecord>;
  findById(id: MasterId): Promise<MasterLicenseRecord | null>;
  listByTenant(tenantId: MasterId): Promise<MasterLicenseRecord[]>;
  list(): Promise<MasterLicenseRecord[]>;
}

export interface ActivationRepository {
  save(record: MasterActivationRecord): Promise<MasterActivationRecord>;
  listByTenant(tenantId: MasterId): Promise<MasterActivationRecord[]>;
  list(): Promise<MasterActivationRecord[]>;
}

export interface BlockRepository {
  save(record: MasterBlockRecord): Promise<MasterBlockRecord>;
  findActiveByTenant(tenantId: MasterId): Promise<MasterBlockRecord | null>;
  listByTenant(tenantId: MasterId): Promise<MasterBlockRecord[]>;
  list(): Promise<MasterBlockRecord[]>;
}

export type MasterRepositories = {
  customers: CustomerRepository;
  tenants: TenantRepository;
  subscriptions: SubscriptionRepository;
  billing: BillingRepository;
  licenses: LicenseRecordRepository;
  activations: ActivationRepository;
  blocks: BlockRepository;
};
