/** RC2-BASELINE-1.0.0 — paths canônicos (override em testes). */
export interface ApiRuntimePaths {
  programFilesRoot: string;
  programDataRoot: string;
  backendRoot: string;
  backendEntry: string;
  nodeExecutable: string;
  backendEnvFile: string;
  configDir: string;
  storageDir: string;
  logsDir: string;
  apiRuntimeLogFile: string;
}

export const REQUIRED_BACKEND_ENV_KEYS = [
  'DATABASE_URL',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
] as const;

export type RequiredBackendEnvKey = (typeof REQUIRED_BACKEND_ENV_KEYS)[number];

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface RuntimeValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ApiRuntimeOptions {
  paths?: Partial<ApiRuntimePaths>;
  healthPort?: number;
  productVersion?: string;
  /** Não iniciar ProcessRunner (somente health + validate) */
  dryRun?: boolean;
}

export interface ApiRuntimeStatus {
  running: boolean;
  backendPid?: number;
  healthPort: number;
  validation: RuntimeValidationResult;
}
