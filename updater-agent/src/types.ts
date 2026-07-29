export type ReleaseComponent = 'platform' | 'rep-agent';
export type ReleaseChannel = 'stable' | 'beta';
export type UpdateKind = 'update' | 'rollback';

export type AgentHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type AgentHealth = {
  status: AgentHealthStatus;
  details?: Record<string, unknown>;
};

export type ReportStage =
  | 'claimed'
  | 'downloading'
  | 'verified'
  | 'backup_completed'
  | 'installing'
  | 'restarting'
  | 'health_check'
  | 'rolling_back'
  | 'completed'
  | 'failed';

export type ReleaseManifest = {
  releaseId: string;
  component: ReleaseComponent;
  channel: ReleaseChannel;
  version: string;
  artifactUrl: string | null;
  sha256: string | null;
  signature: string | null;
  signatureAlgorithm: string | null;
  signerKeyId: string | null;
  artifactSize: number | null;
  rollbackReleaseId: string | null;
};

export type AvailableRequest = {
  requestId: string;
  kind: UpdateKind;
  targetVersion: string;
  fromVersion: string | null;
} | null;

export type ClaimedExecution = {
  requestId: string;
  executionId: string;
  executionToken: string;
  leaseExpiresAt: string;
  kind: UpdateKind;
  fromVersion: string | null;
  targetVersion: string;
  release: ReleaseManifest;
};

export type ReportPayload = {
  executionId: string;
  executionToken: string;
  stage: ReportStage;
  currentVersion?: string | null;
  message?: string | null;
  errorCode?: string | null;
  health?: AgentHealth | null;
  metadata?: Record<string, unknown>;
};

/** Cliente do Control Plane (fala com /api/update-agent/*). */
export interface ControlPlaneClient {
  heartbeat(): Promise<{ availableRequest: AvailableRequest; serverTime: string }>;
  claim(): Promise<ClaimedExecution | null>;
  report(payload: ReportPayload): Promise<{ ok: boolean; finished: boolean }>;
}

/** Baixa o artefato e devolve o caminho local. */
export interface Downloader {
  download(manifest: ReleaseManifest, destDir: string): Promise<{ filePath: string; size: number }>;
}

/** Valida integridade (sha256) e autenticidade (assinatura) do artefato. */
export interface SignatureVerifier {
  verify(filePath: string, manifest: ReleaseManifest): Promise<void>;
}

/** Faz backup e restauração do estado instalado. */
export interface BackupManager {
  backup(targetVersion: string): Promise<{ backupId: string; path: string }>;
  restore(backupId: string): Promise<void>;
}

/** Instala o artefato baixado (troca atômica em staging). */
export interface Installer {
  install(filePath: string, manifest: ReleaseManifest): Promise<void>;
  restartServices(): Promise<void>;
}

/** Verifica saúde pós-restart e a versão efetivamente em execução. */
export interface HealthChecker {
  waitHealthy(expectedVersion: string): Promise<AgentHealth>;
  currentVersion(): Promise<string | null>;
}

export type OrchestratorResult =
  | { status: 'idle' }
  | { status: 'completed'; requestId: string; version: string }
  | { status: 'rolled_back'; requestId: string; errorCode: string }
  | { status: 'failed'; requestId: string; errorCode: string };
