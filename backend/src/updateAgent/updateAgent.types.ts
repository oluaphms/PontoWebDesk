export type AgentHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type AgentHealth = {
  status: AgentHealthStatus;
  details?: Record<string, unknown>;
};

export type HeartbeatInput = {
  machineId?: string | null;
  hardwareHash?: string | null;
  currentVersion?: string | null;
  channel?: 'stable' | 'beta' | 'rc';
  agentVersion?: string | null;
  hostname?: string | null;
  platform?: string | null;
  arch?: string | null;
  health?: AgentHealth | null;
};

export type AvailableRequestSummary = {
  requestId: string;
  kind: 'update' | 'rollback';
  targetVersion: string;
  fromVersion: string | null;
} | null;

export type ReleaseManifest = {
  releaseId: string;
  component: 'platform' | 'rep-agent';
  channel: 'stable' | 'beta' | 'rc';
  version: string;
  artifactUrl: string | null;
  sha256: string | null;
  signature: string | null;
  signatureAlgorithm: string | null;
  signerKeyId: string | null;
  artifactSize: number | null;
  rollbackReleaseId: string | null;
};

export type ClaimResult = {
  requestId: string;
  executionId: string;
  executionToken: string;
  leaseExpiresAt: string;
  kind: 'update' | 'rollback';
  fromVersion: string | null;
  targetVersion: string;
  release: ReleaseManifest;
} | null;

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

export type ReportInput = {
  executionId: string;
  executionToken: string;
  stage: ReportStage;
  currentVersion?: string | null;
  message?: string | null;
  errorCode?: string | null;
  health?: AgentHealth | null;
  metadata?: Record<string, unknown>;
};
