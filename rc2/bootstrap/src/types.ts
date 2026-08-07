import type { InstallStepId } from './installSteps.js';

/**
 * Estados oficiais do install-state.json (RC2-ARCH-1.0.0).
 * RC2.1: pipeline estrutural completo (sem runtime real).
 */
export const INSTALL_STATES = [
  'NOT_STARTED',
  'PRECHECK',
  'INSTALLING',
  'INSTALLED',
  'FAILED',
  'RECOVERY',
] as const;

export type InstallStateName = (typeof INSTALL_STATES)[number];

export interface InstallStateHistoryEntry {
  state: InstallStateName;
  at: string;
  message?: string;
  code?: string;
  step?: InstallStepId;
}

/** Erro registrado por etapa do pipeline RC2.4.2 */
export interface InstallStepError {
  step: InstallStepId;
  code: string;
  message: string;
  at: string;
}

/** Documento persistido em install-state.json */
export interface InstallStateDocument {
  schemaVersion: 1;
  state: InstallStateName;
  /** Etapa corrente do pipeline RC2-ARCH-1.0.0 */
  currentStep: InstallStepId;
  updatedAt: string;
  architectureVersion: string;
  phase: string;
  /** Versão do pacote bootstrap / instalador (rollback futuro) */
  productVersion: string;
  /** RC2.4.2 — etapas concluídas com sucesso */
  completedSteps?: InstallStepId[];
  /** RC2.4.2 — início do pipeline INSTALLING */
  startedAt?: string;
  /** RC2.4.2 — conclusão (INSTALLED ou falha terminal) */
  finishedAt?: string;
  /** RC2.4.2 — erros por etapa (preservados após rollback) */
  errors?: InstallStepError[];
  lastError?: { code: string; message: string };
  history: InstallStateHistoryEntry[];
}

export interface PostgresConnectionConfig {
  host: string;
  port: number;
  database: string;
  superuser: string;
  superuserPassword: string;
  appUser: string;
  appPassword: string;
  migrateUser: string;
  migratePassword: string;
}

export interface PrecheckResult {
  ok: boolean;
  errors: Array<{ code: string; message: string }>;
}

export interface StructuralRunResult {
  ok: boolean;
  finalState: InstallStateName;
  finalStep: InstallStepId;
  message: string;
}

export interface StructuralRunOptions {
  /** Para testes: falha simulada ao persistir esta etapa (aciona recovery). */
  simulateFailureAtStep?: InstallStepId;
}

export type { BootstrapPaths } from './runtime/bootstrapPaths.js';
