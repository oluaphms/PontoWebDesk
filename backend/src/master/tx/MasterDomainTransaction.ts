/**
 * MasterDomainTransaction — fronteira oficial de atomicidade do domínio Master.
 *
 * Uso:
 *   await MasterDomainTransaction.run(async () => {
 *     // todos os pool.queryMaster / masterSql neste escopo
 *     // compartilham o mesmo BEGIN/COMMIT
 *   });
 *
 * Fora da TX (documentado):
 * - DDL de compatibilidade (CREATE OR REPLACE FUNCTION work_shifts)
 * - envio de e-mail / convite first-access
 * - integrações externas (Supabase Auth, SMTP)
 * - audit append in-memory (não é Postgres)
 *
 * Não altera regras de negócio, contratos HTTP nem APIs públicas.
 */
import type { PoolClient } from 'pg';
import {
  isMasterDomainTransactionActive,
  recordMasterDomainStep,
  runMasterDomainTransaction,
} from '../../db/index.js';

export type MasterDomainTransactionOptions = {
  /** Somente testes: simula kill após o step nomeado. */
  crashAfterStep?: string | null;
};

export const MasterDomainTransaction = {
  get isActive(): boolean {
    return isMasterDomainTransactionActive();
  },

  /**
   * Executa writers Master na mesma transação Postgres.
   * Join automático se já houver TX ativa (sagas aninhadas).
   */
  async run<T>(
    fn: (client: PoolClient) => Promise<T>,
    options?: MasterDomainTransactionOptions,
  ): Promise<T> {
    return runMasterDomainTransaction(fn, options);
  },

  /** Marca passo da saga (e opcionalmente dispara crash simulado em testes). */
  step(name: string): void {
    recordMasterDomainStep(name);
  },

  /**
   * Operações que NÃO entram na TX de domínio (side-effects externos / DDL).
   * Mantidas fora para não segurar lock de linha durante I/O externo.
   */
  OUT_OF_TRANSACTION: [
    'enforceWorkShiftsBootstrapCompatibility (DDL)',
    'CommercialJourneyService.resendFirstAccess (e-mail / SMTP)',
    'Supabase Auth admin create (quando habilitado)',
    'MasterAudit append in-memory (não Postgres)',
  ] as const,
};
