/**
 * Composition root do Painel Master — wiring in-memory.
 * Não registra rotas Express. Não importa controllers/db do produto.
 */
import { createInMemoryMasterRepositories } from './adapters/memory/createInMemoryMasterRepositories.js';
import type { MasterRepositories } from './ports/repositories.js';
import { ActivationService } from './services/ActivationService.js';
import { BillingService } from './services/BillingService.js';
import { BlockService } from './services/BlockService.js';
import { CustomerService } from './services/CustomerService.js';
import { DeploymentControlService } from './services/DeploymentControlService.js';
import { LicenseGenerationService } from './services/LicenseGenerationService.js';
import { MasterTenantService } from './services/MasterTenantService.js';
import { SubscriptionService } from './services/SubscriptionService.js';
import { UnlockService } from './services/UnlockService.js';

export type MasterServices = {
  repos: MasterRepositories;
  customers: CustomerService;
  tenants: MasterTenantService;
  subscriptions: SubscriptionService;
  billing: BillingService;
  deploymentControl: DeploymentControlService;
  licenses: LicenseGenerationService;
  activation: ActivationService;
  block: BlockService;
  unlock: UnlockService;
};

export function createMasterServices(repos?: MasterRepositories): MasterServices {
  const r = repos ?? createInMemoryMasterRepositories();
  return {
    repos: r,
    customers: new CustomerService(r.customers),
    tenants: new MasterTenantService(r.tenants, r.customers),
    subscriptions: new SubscriptionService(r.subscriptions, r.tenants, r.customers),
    billing: new BillingService(r.billing, r.customers, r.tenants, r.subscriptions),
    deploymentControl: new DeploymentControlService(r.tenants),
    licenses: new LicenseGenerationService(r.licenses, r.tenants, r.customers),
    activation: new ActivationService(r.activations, r.licenses, r.tenants),
    block: new BlockService(r.blocks, r.tenants),
    unlock: new UnlockService(r.blocks, r.tenants),
  };
}
