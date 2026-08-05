export type ReleaseComponent = 'platform' | 'rep-agent';
export type ReleaseChannel = 'stable' | 'beta' | 'rc';
export type ReleaseStatus = 'draft' | 'published' | 'withdrawn';
export type InstallationMode = 'LOCAL' | 'HYBRID';
export type InstallationUpdateStatus = 'current' | 'outdated' | 'unknown';
export type UpdateRequestKind = 'update' | 'rollback';
export type UpdateRequestStatus =
  | 'requested'
  | 'approved'
  | 'manual_required'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MasterRelease = {
  id: string;
  component: ReleaseComponent;
  version: string;
  channel: ReleaseChannel;
  status: ReleaseStatus;
  changelog: string;
  artifactUrl: string | null;
  sha256: string | null;
  signature: string | null;
  signatureAlgorithm: string | null;
  signerKeyId: string | null;
  artifactSize: number | null;
  minSupportedVersion: string | null;
  rollbackReleaseId: string | null;
  publishedAt: string | null;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MasterInstallation = {
  id: string;
  companyId: string;
  companyName: string;
  mode: InstallationMode;
  component: ReleaseComponent;
  channel: ReleaseChannel;
  reportedVersion: string | null;
  latestVersion: string | null;
  updateStatus: InstallationUpdateStatus;
  lastSeenAt: string | null;
  source: 'manual' | 'heartbeat' | 'deployment';
  targetReleaseId: string | null;
  activeRequestId: string | null;
  activeRequestStatus: UpdateRequestStatus | null;
  /** Última atualização concluída (request completed) ou updated_at da instalação. */
  lastUpdateAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MasterUpdateRequest = {
  id: string;
  installationId: string;
  releaseId: string;
  kind: UpdateRequestKind;
  status: UpdateRequestStatus;
  fromVersion: string | null;
  targetVersion: string;
  reason: string | null;
  requestedBy: string | null;
  requestedEmail: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  companyName?: string;
  component?: ReleaseComponent;
};

export type MasterUpdateEvent = {
  id: string;
  requestId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  message: string;
  actorId: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  companyName?: string;
  component?: ReleaseComponent;
  fromVersion?: string | null;
  targetVersion?: string;
};

