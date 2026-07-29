import { masterApi } from './masterApi';

export type ReleaseComponent = 'platform' | 'rep-agent';
export type ReleaseChannel = 'stable' | 'beta' | 'rc';
export type ReleaseStatus = 'draft' | 'published' | 'withdrawn';
export type InstallationUpdateStatus = 'current' | 'outdated' | 'unknown';
export type UpdateRequestKind = 'update' | 'rollback';
export type UpdateRequestStatus =
  | 'requested'
  | 'approved'
  | 'manual_required'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type UpdatesCentralStatusCode =
  | 'updated'
  | 'pending'
  | 'executing'
  | 'failed'
  | 'rollback'
  | 'outdated'
  | 'unknown';

export type MasterRelease = {
  id: string;
  component: ReleaseComponent;
  version: string;
  channel: ReleaseChannel;
  status: ReleaseStatus;
  changelog: string;
  artifactUrl: string | null;
  sha256: string | null;
  minSupportedVersion: string | null;
  rollbackReleaseId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MasterInstallation = {
  id: string;
  companyId: string;
  companyName: string;
  mode: 'LOCAL' | 'HYBRID';
  component: ReleaseComponent;
  channel: ReleaseChannel;
  reportedVersion: string | null;
  latestVersion: string | null;
  updateStatus: InstallationUpdateStatus;
  lastSeenAt: string | null;
  lastUpdateAt?: string | null;
  source: 'manual' | 'heartbeat' | 'deployment';
  targetReleaseId: string | null;
  activeRequestId: string | null;
  activeRequestStatus: UpdateRequestStatus | null;
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
  companyName?: string;
  component?: ReleaseComponent;
  createdAt: string;
  completedAt?: string | null;
  failedAt?: string | null;
};

export type MasterUpdateEvent = {
  id: string;
  requestId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  message: string;
  actorEmail: string | null;
  createdAt: string;
  companyName?: string;
  component?: ReleaseComponent;
  fromVersion?: string | null;
  targetVersion?: string;
};

export type UpdatesCentralRow = {
  installationId: string;
  companyId: string;
  companyName: string;
  mode: 'LOCAL' | 'HYBRID';
  component: ReleaseComponent;
  channel: ReleaseChannel;
  channelLabel: string;
  version: string | null;
  latestVersion: string | null;
  statusCode: UpdatesCentralStatusCode;
  statusLabel: string;
  lastHeartbeatAt: string | null;
  lastUpdateAt: string | null;
  activeRequestId: string | null;
  activeRequestStatus: UpdateRequestStatus | null;
  activeRequestKind: UpdateRequestKind | null;
  updateStatus: InstallationUpdateStatus;
};

export type UpdatesCentralSnapshot = {
  currentPlatformVersion: string | null;
  latestRelease: {
    version: string | null;
    channel: ReleaseChannel | null;
    publishedAt: string | null;
    component: string | null;
  };
  channels: Array<{
    channel: ReleaseChannel;
    label: string;
    latestReleaseVersion: string | null;
    installationCount: number;
  }>;
  counts: {
    updated: number;
    pending: number;
    executing: number;
    failed: number;
    rollback: number;
  };
  rows: UpdatesCentralRow[];
  agentOnlyExecution: true;
  note: string;
};

export async function fetchUpdatesCentral(): Promise<UpdatesCentralSnapshot> {
  const res = await masterApi<{ ok: boolean; central: UpdatesCentralSnapshot }>(
    '/updates/central',
  );
  return res.central;
}

export async function fetchReleases(): Promise<MasterRelease[]> {
  const res = await masterApi<{ ok: boolean; releases: MasterRelease[] }>('/updates/releases');
  return res.releases ?? [];
}

export async function createRelease(input: {
  component: ReleaseComponent;
  version: string;
  channel: ReleaseChannel;
  changelog: string;
  artifactUrl?: string;
  sha256?: string;
  minSupportedVersion?: string;
  rollbackReleaseId?: string;
}): Promise<MasterRelease> {
  const res = await masterApi<{ ok: boolean; release: MasterRelease }>('/updates/releases', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.release;
}

export async function runReleaseAction(
  releaseId: string,
  action: 'publish' | 'withdraw',
): Promise<MasterRelease> {
  const res = await masterApi<{ ok: boolean; release: MasterRelease }>(
    `/updates/releases/${encodeURIComponent(releaseId)}/actions/${action}`,
    { method: 'POST', body: '{}' },
  );
  return res.release;
}

export async function fetchInstallations(): Promise<MasterInstallation[]> {
  const res = await masterApi<{ ok: boolean; installations: MasterInstallation[] }>(
    '/updates/installations',
  );
  return res.installations ?? [];
}

export async function upsertInstallation(input: {
  companyId: string;
  companyName: string;
  mode: 'LOCAL' | 'HYBRID';
  component: ReleaseComponent;
  channel: ReleaseChannel;
  reportedVersion?: string;
}): Promise<MasterInstallation> {
  const res = await masterApi<{ ok: boolean; installation: MasterInstallation }>(
    '/updates/installations',
    { method: 'POST', body: JSON.stringify(input) },
  );
  return res.installation;
}

export async function fetchUpdateRequests(): Promise<MasterUpdateRequest[]> {
  const res = await masterApi<{ ok: boolean; requests: MasterUpdateRequest[] }>(
    '/updates/requests',
  );
  return res.requests ?? [];
}

export async function createUpdateRequest(input: {
  installationId: string;
  releaseId: string;
  kind: UpdateRequestKind;
  reason?: string;
}): Promise<MasterUpdateRequest> {
  const res = await masterApi<{ ok: boolean; request: MasterUpdateRequest }>(
    '/updates/requests',
    { method: 'POST', body: JSON.stringify(input) },
  );
  return res.request;
}

export async function runUpdateRequestAction(
  requestId: string,
  action: 'approve' | 'cancel' | 'retry',
  message?: string,
): Promise<MasterUpdateRequest> {
  const res = await masterApi<{ ok: boolean; request: MasterUpdateRequest }>(
    `/updates/requests/${encodeURIComponent(requestId)}/actions/${action}`,
    { method: 'POST', body: JSON.stringify({ message }) },
  );
  return res.request;
}

export async function fetchUpdateHistory(opts?: {
  limit?: number;
  requestId?: string;
  installationId?: string;
}): Promise<MasterUpdateEvent[]> {
  const params = new URLSearchParams();
  params.set('limit', String(opts?.limit ?? 500));
  if (opts?.requestId) params.set('requestId', opts.requestId);
  if (opts?.installationId) params.set('installationId', opts.installationId);
  const res = await masterApi<{ ok: boolean; events: MasterUpdateEvent[] }>(
    `/updates/history?${params.toString()}`,
  );
  return res.events ?? [];
}

export const CHANNEL_LABELS: Record<ReleaseChannel, string> = {
  stable: 'Estável',
  beta: 'Beta',
  rc: 'Candidato a lançamento',
};
