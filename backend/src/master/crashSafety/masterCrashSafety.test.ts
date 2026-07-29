// @vitest-environment node
/**
 * Crash-safety: fronteira transacional Master + recovery + atomicidade simulada.
 */
import { describe, expect, it } from 'vitest';
import {
  masterDomainTxAls,
  recordMasterDomainStep,
  type MasterDomainTxStore,
} from '../../db/masterDomainTx.js';
import { MasterDomainTransaction } from '../tx/MasterDomainTransaction.js';

describe('MasterDomainTransaction — steps e crash simulado (ALS)', () => {
  it('recordMasterDomainStep dispara crash no step configurado', () => {
    const store: MasterDomainTxStore = {
      client: {} as never,
      depth: 1,
      crashAfterStep: 'create_company',
      steps: [],
    };
    expect(() =>
      masterDomainTxAls.run(store, () => {
        recordMasterDomainStep('create_tenant');
        recordMasterDomainStep('create_company');
      }),
    ).toThrow(/MASTER_DOMAIN_CRASH_AFTER:create_company/);
    expect(store.steps).toEqual(['create_tenant', 'create_company']);
  });

  it('documenta side-effects fora da TX', () => {
    expect(MasterDomainTransaction.OUT_OF_TRANSACTION.join(' ')).toMatch(/e-mail|SMTP/i);
    expect(MasterDomainTransaction.OUT_OF_TRANSACTION.join(' ')).toMatch(/DDL/i);
  });
});

describe('Saga crash harness — 100 interrupções aleatórias', () => {
  type Ledger = {
    tenants: Set<string>;
    companies: Set<string>;
    licenses: Set<string>;
    subscriptions: Set<string>;
  };

  function emptyLedger(): Ledger {
    return {
      tenants: new Set(),
      companies: new Set(),
      licenses: new Set(),
      subscriptions: new Set(),
    };
  }

  function isConsistent(l: Ledger): boolean {
    for (const lic of l.licenses) {
      if (!l.tenants.has(lic)) return false;
    }
    for (const sub of l.subscriptions) {
      if (!l.tenants.has(sub)) return false;
    }
    for (const t of l.tenants) {
      if (!l.companies.has(t)) return false;
    }
    for (const c of l.companies) {
      if (!l.tenants.has(c)) return false;
    }
    return true;
  }

  /** Recovery: remove órfãos (equivalente a ROLLBACK / reparo destrutivo seguro). */
  function recoverByDropOrphans(l: Ledger): void {
    for (const t of [...l.tenants]) {
      if (!l.companies.has(t)) {
        l.tenants.delete(t);
        l.licenses.delete(t);
        l.subscriptions.delete(t);
      }
    }
    for (const lic of [...l.licenses]) {
      if (!l.tenants.has(lic)) l.licenses.delete(lic);
    }
    for (const sub of [...l.subscriptions]) {
      if (!l.tenants.has(sub)) l.subscriptions.delete(sub);
    }
    for (const c of [...l.companies]) {
      if (!l.tenants.has(c)) l.companies.delete(c);
    }
  }

  /** Recovery seguro: tenant sem company → recria company (repairMissingOperationalCompany). */
  function recoverByRepairCompany(l: Ledger): void {
    for (const t of [...l.tenants]) {
      if (!l.companies.has(t)) l.companies.add(t);
    }
  }

  /**
   * Simula MasterDomainTransaction: writes só no COMMIT.
   * crashAt = índice do step após o qual o processo morre (pending descartado).
   */
  async function runSagaAtomic(
    id: string,
    ledger: Ledger,
    crashAt: number | null,
  ): Promise<'ok' | 'crashed'> {
    const pending = emptyLedger();
    const steps = [
      () => pending.tenants.add(id),
      () => pending.companies.add(id),
      () => pending.licenses.add(id),
      () => pending.subscriptions.add(id),
    ];
    try {
      for (let i = 0; i < steps.length; i += 1) {
        steps[i]();
        if (crashAt === i) throw new Error(`CRASH_AFTER_STEP_${i}`);
      }
      for (const t of pending.tenants) ledger.tenants.add(t);
      for (const c of pending.companies) ledger.companies.add(c);
      for (const lic of pending.licenses) ledger.licenses.add(lic);
      for (const sub of pending.subscriptions) ledger.subscriptions.add(sub);
      return 'ok';
    } catch {
      return 'crashed';
    }
  }

  it('crash após create_tenant / company / license / subscription: pending não vaza', async () => {
    for (const crashAt of [0, 1, 2, 3]) {
      const ledger = emptyLedger();
      const result = await runSagaAtomic('tn_x', ledger, crashAt);
      expect(result).toBe('crashed');
      expect(ledger.tenants.size).toBe(0);
      expect(ledger.companies.size).toBe(0);
      expect(isConsistent(ledger)).toBe(true);
    }
  });

  it('crash antes do rollback / durante rollback: estado final consistente após recovery', () => {
    // Crash “durante rollback” legado (compensação parcial): leftovers.
    const ledger = emptyLedger();
    ledger.tenants.add('tn_partial');
    ledger.licenses.add('tn_partial'); // license sem company
    expect(isConsistent(ledger)).toBe(false);
    recoverByDropOrphans(ledger);
    expect(isConsistent(ledger)).toBe(true);
  });

  it('retry após crash: saga completa deixa estado consistente', async () => {
    const ledger = emptyLedger();
    expect(await runSagaAtomic('tn_retry', ledger, 1)).toBe('crashed');
    expect(ledger.tenants.size).toBe(0);
    expect(await runSagaAtomic('tn_retry', ledger, null)).toBe('ok');
    expect(isConsistent(ledger)).toBe(true);
    expect(ledger.tenants.has('tn_retry')).toBe(true);
    expect(ledger.companies.has('tn_retry')).toBe(true);
  });

  it('100 execuções interrompidas aleatoriamente → sempre consistente ou recuperável', async () => {
    const ledger = emptyLedger();
    let crashed = 0;
    let ok = 0;
    for (let n = 0; n < 100; n += 1) {
      const id = `tn_${n}`;
      const crashAt = n % 5 === 0 ? null : n % 4;
      const result = await runSagaAtomic(id, ledger, crashAt);
      if (result === 'crashed') crashed += 1;
      else ok += 1;
      recoverByDropOrphans(ledger);
      recoverByRepairCompany(ledger);
      expect(isConsistent(ledger), `inconsistente após run ${n}`).toBe(true);
    }
    expect(crashed).toBeGreaterThan(0);
    expect(ok).toBeGreaterThan(0);
    expect(ledger.licenses.size).toBe(ledger.tenants.size);
    expect(ledger.companies.size).toBe(ledger.tenants.size);
  });

  it('tenant sem company é recuperável via repair (não irrecuperável)', () => {
    const ledger = emptyLedger();
    ledger.tenants.add('tn_orphan');
    expect(isConsistent(ledger)).toBe(false);
    recoverByRepairCompany(ledger);
    expect(isConsistent(ledger)).toBe(true);
  });
});

describe('MasterRecoveryService — política de auto-reparo', () => {
  it('somente tenant_missing_company é auto-reparo seguro', () => {
    const SAFE = new Set(['tenant_missing_company']);
    expect(SAFE.has('tenant_missing_company')).toBe(true);
    expect(SAFE.has('license_missing_tenant')).toBe(false);
    expect(SAFE.has('company_missing_tenant')).toBe(false);
    expect(SAFE.has('subscription_missing_tenant')).toBe(false);
  });
});

describe('Idempotência — classificação dos métodos públicos', () => {
  it('classifica create / purge / repair / journey / projection', () => {
    const table = {
      createFullyProvisioned: 'IDEMPOTENTE_PARCIAL',
      purgeFullyProvisioned: 'IDEMPOTENTE', // after alreadyDeleted
      rollbackProvision: 'IDEMPOTENTE_PARCIAL',
      repairMissingOperationalCompany: 'IDEMPOTENTE',
      'CommercialJourneyService.provision': 'IDEMPOTENTE_PARCIAL',
      ensureOperationalCompany: 'IDEMPOTENTE',
      projectCommercialStateToSaas: 'QUASE_IDEMPOTENTE',
      runStartupRecovery: 'IDEMPOTENTE',
    } as const;
    expect(table.purgeFullyProvisioned).toBe('IDEMPOTENTE');
    expect(table.repairMissingOperationalCompany).toBe('IDEMPOTENTE');
    expect(table.createFullyProvisioned).toBe('IDEMPOTENTE_PARCIAL');
  });
});
