/**
 * Central de Atualizações — composição operacional (somente Master).
 * Contagens e linhas derivadas do Control Plane; execução permanece no Update Agent.
 */
import type {
  MasterInstallation,
  MasterRelease,
  MasterUpdateEvent,
  MasterUpdateRequest,
  ReleaseChannel,
  UpdateRequestStatus,
} from './updateControlPlane.types.js';

export type UpdatesCentralStatusCode =
  | 'updated'
  | 'pending'
  | 'executing'
  | 'failed'
  | 'rollback'
  | 'outdated'
  | 'unknown';

export type UpdatesCentralCounts = {
  updated: number;
  pending: number;
  executing: number;
  failed: number;
  rollback: number;
};

export type UpdatesCentralChannelSummary = {
  channel: ReleaseChannel;
  label: string;
  latestReleaseVersion: string | null;
  installationCount: number;
};

export type UpdatesCentralRow = {
  installationId: string;
  companyId: string;
  companyName: string;
  mode: MasterInstallation['mode'];
  component: MasterInstallation['component'];
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
  activeRequestKind: MasterUpdateRequest['kind'] | null;
  updateStatus: MasterInstallation['updateStatus'];
};

export type UpdatesCentralSnapshot = {
  currentPlatformVersion: string | null;
  latestRelease: {
    version: string | null;
    channel: ReleaseChannel | null;
    publishedAt: string | null;
    component: string | null;
  };
  channels: UpdatesCentralChannelSummary[];
  counts: UpdatesCentralCounts;
  rows: UpdatesCentralRow[];
  agentOnlyExecution: true;
  note: string;
};

const CHANNEL_LABEL: Record<ReleaseChannel, string> = {
  stable: 'Stable',
  beta: 'Beta',
  rc: 'Release Candidate',
};

const STATUS_LABEL: Record<UpdatesCentralStatusCode, string> = {
  updated: 'Atualizado',
  pending: 'Pendente',
  executing: 'Executando',
  failed: 'Falhou',
  rollback: 'Rollback',
  outdated: 'Desatualizado',
  unknown: 'Desconhecido',
};

function channelLabel(channel: ReleaseChannel): string {
  return CHANNEL_LABEL[channel] ?? channel;
}

function latestPublished(
  releases: readonly MasterRelease[],
  channel?: ReleaseChannel,
  component: MasterRelease['component'] = 'platform',
): MasterRelease | null {
  const published = releases
    .filter(
      (r) =>
        r.status === 'published' &&
        r.component === component &&
        (channel == null || r.channel === channel),
    )
    .sort((a, b) => {
      const ta = Date.parse(a.publishedAt || a.createdAt);
      const tb = Date.parse(b.publishedAt || b.createdAt);
      return tb - ta;
    });
  return published[0] ?? null;
}

function lastCompletedAt(
  installationId: string,
  requests: readonly MasterUpdateRequest[],
): string | null {
  let best: string | null = null;
  for (const req of requests) {
    if (req.installationId !== installationId) continue;
    if (req.status !== 'completed' || !req.completedAt) continue;
    if (!best || Date.parse(req.completedAt) > Date.parse(best)) {
      best = req.completedAt;
    }
  }
  return best;
}

function latestRequestFor(
  installationId: string,
  requests: readonly MasterUpdateRequest[],
): MasterUpdateRequest | null {
  let best: MasterUpdateRequest | null = null;
  for (const req of requests) {
    if (req.installationId !== installationId) continue;
    if (!best || Date.parse(req.createdAt) > Date.parse(best.createdAt)) {
      best = req;
    }
  }
  return best;
}

function activeRequestFor(
  installation: MasterInstallation,
  requests: readonly MasterUpdateRequest[],
): MasterUpdateRequest | null {
  if (!installation.activeRequestId) return null;
  return requests.find((r) => r.id === installation.activeRequestId) ?? null;
}

export function deriveInstallationStatus(
  installation: MasterInstallation,
  requests: readonly MasterUpdateRequest[],
): UpdatesCentralStatusCode {
  const active = activeRequestFor(installation, requests);
  if (active) {
    if (active.kind === 'rollback') {
      if (active.status === 'failed') return 'failed';
      if (active.status === 'requested') return 'pending';
      if (active.status === 'approved' || active.status === 'manual_required') {
        return 'rollback';
      }
    }
    if (active.status === 'requested') return 'pending';
    if (active.status === 'approved' || active.status === 'manual_required') {
      return 'executing';
    }
  }

  const latest = latestRequestFor(installation.id, requests);
  if (latest?.status === 'failed') {
    return latest.kind === 'rollback' ? 'rollback' : 'failed';
  }

  if (installation.updateStatus === 'current') return 'updated';
  if (installation.updateStatus === 'outdated') return 'pending';
  return 'unknown';
}

export function composeUpdatesCentral(input: {
  releases: readonly MasterRelease[];
  installations: readonly MasterInstallation[];
  requests: readonly MasterUpdateRequest[];
  currentPlatformVersion?: string | null;
}): UpdatesCentralSnapshot {
  const { releases, installations, requests } = input;
  const latestAny = latestPublished(releases);

  const channels: UpdatesCentralChannelSummary[] = (['stable', 'beta', 'rc'] as const).map(
    (channel) => {
      const latest = latestPublished(releases, channel);
      return {
        channel,
        label: channelLabel(channel),
        latestReleaseVersion: latest?.version ?? null,
        installationCount: installations.filter((i) => i.channel === channel).length,
      };
    },
  );

  const rows: UpdatesCentralRow[] = installations.map((installation) => {
    const statusCode = deriveInstallationStatus(installation, requests);
    const active = activeRequestFor(installation, requests);
    return {
      installationId: installation.id,
      companyId: installation.companyId,
      companyName: installation.companyName,
      mode: installation.mode,
      component: installation.component,
      channel: installation.channel,
      channelLabel: channelLabel(installation.channel),
      version: installation.reportedVersion,
      latestVersion: installation.latestVersion,
      statusCode,
      statusLabel: STATUS_LABEL[statusCode],
      lastHeartbeatAt: installation.lastSeenAt,
      lastUpdateAt:
        lastCompletedAt(installation.id, requests) ?? installation.updatedAt ?? null,
      activeRequestId: installation.activeRequestId,
      activeRequestStatus: installation.activeRequestStatus,
      activeRequestKind: active?.kind ?? null,
      updateStatus: installation.updateStatus,
    };
  });

  const counts: UpdatesCentralCounts = {
    updated: 0,
    pending: 0,
    executing: 0,
    failed: 0,
    rollback: 0,
  };
  for (const row of rows) {
    if (row.statusCode === 'updated') counts.updated += 1;
    else if (row.statusCode === 'pending' || row.statusCode === 'outdated') counts.pending += 1;
    else if (row.statusCode === 'executing') counts.executing += 1;
    else if (row.statusCode === 'failed') counts.failed += 1;
    else if (row.statusCode === 'rollback') counts.rollback += 1;
  }

  return {
    currentPlatformVersion: input.currentPlatformVersion ?? null,
    latestRelease: {
      version: latestAny?.version ?? null,
      channel: latestAny?.channel ?? null,
      publishedAt: latestAny?.publishedAt ?? null,
      component: latestAny?.component ?? null,
    },
    channels,
    counts,
    rows,
    agentOnlyExecution: true,
    note:
      'Central operacional — aprovação no Master; download/install/health/completed exclusivamente pelo Update Agent',
  };
}

export function filterUpdateHistory(
  events: readonly MasterUpdateEvent[],
  opts?: { requestId?: string | null; installationId?: string | null; companyName?: string | null },
): MasterUpdateEvent[] {
  const requestId = opts?.requestId?.trim() || null;
  const installationId = opts?.installationId?.trim() || null;
  const companyName = opts?.companyName?.trim().toLowerCase() || null;
  return events.filter((event) => {
    if (requestId && event.requestId !== requestId) return false;
    if (companyName && String(event.companyName || '').toLowerCase() !== companyName) {
      return false;
    }
    if (installationId) {
      const metaId =
        event.metadata && typeof event.metadata.installationId === 'string'
          ? event.metadata.installationId
          : null;
      if (metaId && metaId !== installationId) return false;
      // Sem metadata: filtra só por requestId externo; se só installationId, mantém se company bate
    }
    return true;
  });
}

export { CHANNEL_LABEL, STATUS_LABEL };
