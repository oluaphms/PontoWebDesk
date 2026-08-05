/**
 * Contexto de transação de domínio Master (AsyncLocalStorage).
 * Permite que vários pool.queryMaster compartilhem o mesmo BEGIN/COMMIT.
 * Não altera regras de negócio — só a fronteira de atomicidade.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

export type MasterDomainTxStore = {
  client: PoolClient;
  depth: number;
  /** Marcadores de crash injectáveis em testes. */
  crashAfterStep?: string | null;
  steps: string[];
};

export const masterDomainTxAls = new AsyncLocalStorage<MasterDomainTxStore>();

export function getMasterDomainTxClient(): PoolClient | null {
  return masterDomainTxAls.getStore()?.client ?? null;
}

export function isMasterDomainTransactionActive(): boolean {
  return Boolean(masterDomainTxAls.getStore()?.client);
}

export function recordMasterDomainStep(step: string): void {
  const store = masterDomainTxAls.getStore();
  if (!store) return;
  store.steps.push(step);
  if (store.crashAfterStep && store.crashAfterStep === step) {
    const err = new Error(`MASTER_DOMAIN_CRASH_AFTER:${step}`);
    (err as { code?: string }).code = 'MASTER_DOMAIN_CRASH_SIMULATED';
    throw err;
  }
}
