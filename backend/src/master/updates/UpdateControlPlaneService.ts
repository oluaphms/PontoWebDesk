import { randomUUID } from 'node:crypto';
import { pool } from '../../db/index.js';
import { compareSemver, isValidSemver } from './semver.js';
import type {
  InstallationMode,
  InstallationUpdateStatus,
  MasterInstallation,
  MasterRelease,
  MasterUpdateEvent,
  MasterUpdateRequest,
  ReleaseChannel,
  ReleaseComponent,
  UpdateRequestKind,
  UpdateRequestStatus,
} from './updateControlPlane.types.js';
import { composeUpdatesCentral } from './composeUpdatesCentral.js';

type Actor = { userId?: string | null; email?: string | null };
type Row = Record<string, unknown>;

const COMPONENTS = new Set<ReleaseComponent>(['platform', 'rep-agent']);
const CHANNELS = new Set<ReleaseChannel>(['stable', 'beta', 'rc']);
const MODES = new Set<InstallationMode>(['LOCAL', 'HYBRID']);
/**
 * Transições permitidas pelo Painel Master (admin).
 * `completed` e `failed` só o Updater Agent grava (via /api/update-agent/report).
 * `manual_required` só o agente define no claim (em execução).
 */
const MASTER_REQUEST_TRANSITIONS: Record<UpdateRequestStatus, readonly UpdateRequestStatus[]> = {
  requested: ['approved', 'cancelled'],
  approved: ['cancelled'],
  manual_required: ['cancelled'],
  completed: [],
  failed: ['approved', 'cancelled'],
  cancelled: [],
};

const AGENT_ONLY_STATUSES = new Set<UpdateRequestStatus>(['completed', 'failed', 'manual_required']);

function signatureRequiredByPolicy(signatureAlgorithm: string | null): boolean {
  const envFlag = String(process.env.MASTER_UPDATE_REQUIRE_SIGNATURE ?? '')
    .trim()
    .toLowerCase();
  if (envFlag === '1' || envFlag === 'true' || envFlag === 'yes') return true;
  const algo = (signatureAlgorithm ?? '').trim().toLowerCase();
  if (!algo || algo === 'sha256') return false;
  return true;
}

function assertHttpsArtifactUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UpdateControlPlaneError(400, 'INVALID_ARTIFACT_URL', 'URL do artefato inválida.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' &&
    host !== 'localhost' &&
    host !== '127.0.0.1'
  ) {
    throw new UpdateControlPlaneError(
      400,
      'ARTIFACT_URL_MUST_BE_HTTPS',
      'Artefato deve usar HTTPS (localhost permitido apenas em lab).',
    );
  }
}

/** Valida pré-condições para publicar uma release (fail-closed). */
export function assertReleasePublishable(row: {
  artifact_url?: unknown;
  sha256?: unknown;
  signature?: unknown;
  signature_algorithm?: unknown;
  signer_key_id?: unknown;
}): void {
  const artifactUrl = nullable(row.artifact_url);
  if (!artifactUrl) {
    throw new UpdateControlPlaneError(
      409,
      'ARTIFACT_URL_REQUIRED',
      'Publique somente com artifactUrl preenchido.',
    );
  }
  assertHttpsArtifactUrl(artifactUrl);
  const sha256 = nullable(row.sha256)?.toLowerCase() ?? null;
  if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new UpdateControlPlaneError(
      409,
      'SHA256_REQUIRED',
      'Publique somente com SHA-256 válido (64 hexadecimais).',
    );
  }
  const algo = nullable(row.signature_algorithm);
  if (signatureRequiredByPolicy(algo)) {
    if (!nullable(row.signature)) {
      throw new UpdateControlPlaneError(
        409,
        'SIGNATURE_REQUIRED',
        'Assinatura digital obrigatória para publicar (MASTER_UPDATE_REQUIRE_SIGNATURE ou algoritmo ≠ sha256).',
      );
    }
    if (!nullable(row.signer_key_id)) {
      throw new UpdateControlPlaneError(
        409,
        'SIGNER_KEY_ID_REQUIRED',
        'signerKeyId é obrigatório quando a assinatura digital está habilitada.',
      );
    }
  }
}

export class UpdateControlPlaneError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UpdateControlPlaneError';
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function nullable(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function releaseFromRow(row: Row): MasterRelease {
  return {
    id: String(row.id),
    component: row.component as ReleaseComponent,
    version: String(row.version),
    channel: row.channel as ReleaseChannel,
    status: row.status as MasterRelease['status'],
    changelog: String(row.changelog ?? ''),
    artifactUrl: nullable(row.artifact_url),
    sha256: nullable(row.sha256),
    signature: nullable(row.signature),
    signatureAlgorithm: nullable(row.signature_algorithm),
    signerKeyId: nullable(row.signer_key_id),
    artifactSize:
      row.artifact_size == null || row.artifact_size === ''
        ? null
        : Number(row.artifact_size),
    minSupportedVersion: nullable(row.min_supported_version),
    rollbackReleaseId: nullable(row.rollback_release_id),
    publishedAt: nullable(row.published_at),
    createdBy: nullable(row.created_by),
    createdByEmail: nullable(row.created_by_email),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function requestFromRow(row: Row): MasterUpdateRequest {
  return {
    id: String(row.id),
    installationId: String(row.installation_id),
    releaseId: String(row.release_id),
    kind: row.kind as UpdateRequestKind,
    status: row.status as UpdateRequestStatus,
    fromVersion: nullable(row.from_version),
    targetVersion: String(row.target_version),
    reason: nullable(row.reason),
    requestedBy: nullable(row.requested_by),
    requestedEmail: nullable(row.requested_email),
    approvedBy: nullable(row.approved_by),
    approvedAt: nullable(row.approved_at),
    completedAt: nullable(row.completed_at),
    failedAt: nullable(row.failed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    companyName: nullable(row.company_name) ?? undefined,
    component: (nullable(row.component) as ReleaseComponent | null) ?? undefined,
  };
}

function eventFromRow(row: Row): MasterUpdateEvent {
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    eventType: String(row.event_type),
    fromStatus: nullable(row.from_status),
    toStatus: nullable(row.to_status),
    message: String(row.message),
    actorId: nullable(row.actor_id),
    actorEmail: nullable(row.actor_email),
    metadata,
    createdAt: String(row.created_at),
    companyName: nullable(row.company_name) ?? undefined,
    component: (nullable(row.component) as ReleaseComponent | null) ?? undefined,
    fromVersion: nullable(row.from_version),
    targetVersion: nullable(row.target_version) ?? undefined,
  };
}

function installationFromRow(row: Row): MasterInstallation {
  const reportedVersion = nullable(row.reported_version);
  const latestVersion = nullable(row.latest_version);
  let updateStatus: InstallationUpdateStatus = 'unknown';
  if (reportedVersion && latestVersion) {
    const comparison = compareSemver(reportedVersion, latestVersion);
    if (comparison != null) updateStatus = comparison < 0 ? 'outdated' : 'current';
  }
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    companyName: String(row.company_name),
    mode: row.mode as InstallationMode,
    component: row.component as ReleaseComponent,
    channel: row.channel as ReleaseChannel,
    reportedVersion,
    latestVersion,
    updateStatus,
    lastSeenAt: nullable(row.last_seen_at),
    source: row.source as MasterInstallation['source'],
    targetReleaseId: nullable(row.target_release_id),
    activeRequestId: nullable(row.active_request_id),
    activeRequestStatus: (nullable(row.active_request_status) as UpdateRequestStatus | null) ?? null,
    lastUpdateAt: nullable(row.last_update_at) ?? nullable(row.updated_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function appendEvent(input: {
  requestId: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  message: string;
  actor?: Actor;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pool.queryMaster(
    `insert into public.master_update_events (
       id, request_id, event_type, from_status, to_status, message,
       actor_id, actor_email, metadata
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      id('uev'),
      input.requestId,
      input.eventType,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.message,
      input.actor?.userId ?? null,
      input.actor?.email ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export const UpdateControlPlaneService = {
  async listReleases(): Promise<MasterRelease[]> {
    const result = await pool.queryMaster(
      `select * from public.master_releases
        order by coalesce(published_at, created_at) desc, created_at desc`,
    );
    return result.rows.map((row) => releaseFromRow(row as Row));
  },

  async createRelease(
    input: {
      component: ReleaseComponent;
      version: string;
      channel?: ReleaseChannel;
      changelog?: string;
      artifactUrl?: string | null;
      sha256?: string | null;
      signature?: string | null;
      signatureAlgorithm?: string | null;
      signerKeyId?: string | null;
      artifactSize?: number | null;
      minSupportedVersion?: string | null;
      rollbackReleaseId?: string | null;
    },
    actor: Actor,
  ): Promise<MasterRelease> {
    if (!COMPONENTS.has(input.component)) {
      throw new UpdateControlPlaneError(400, 'INVALID_COMPONENT', 'Componente inválido.');
    }
    const channel = input.channel ?? 'stable';
    if (!CHANNELS.has(channel)) {
      throw new UpdateControlPlaneError(400, 'INVALID_CHANNEL', 'Canal inválido.');
    }
    if (!isValidSemver(input.version)) {
      throw new UpdateControlPlaneError(400, 'INVALID_SEMVER', 'Versão deve seguir SemVer (x.y.z).');
    }
    if (!text(input.changelog)) {
      throw new UpdateControlPlaneError(400, 'CHANGELOG_REQUIRED', 'Changelog é obrigatório.');
    }
    if (input.minSupportedVersion && !isValidSemver(input.minSupportedVersion)) {
      throw new UpdateControlPlaneError(
        400,
        'INVALID_MIN_SUPPORTED_VERSION',
        'Versão mínima deve seguir SemVer.',
      );
    }
    const sha256 = nullable(input.sha256)?.toLowerCase() ?? null;
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new UpdateControlPlaneError(400, 'INVALID_SHA256', 'SHA-256 deve ter 64 hexadecimais.');
    }
    const artifactUrl = nullable(input.artifactUrl);
    if (artifactUrl) assertHttpsArtifactUrl(artifactUrl);
    const signatureAlgorithm = nullable(input.signatureAlgorithm);
    const signature = nullable(input.signature);
    const signerKeyId = nullable(input.signerKeyId);
    if (signatureRequiredByPolicy(signatureAlgorithm) && (!signature || !signerKeyId)) {
      throw new UpdateControlPlaneError(
        400,
        'SIGNATURE_REQUIRED',
        'Assinatura e signerKeyId são obrigatórios quando a política de assinatura está ativa.',
      );
    }
    const rollbackReleaseId = nullable(input.rollbackReleaseId);
    if (rollbackReleaseId) {
      const rollback = await pool.queryMaster(
        `select id from public.master_releases
          where id = $1 and component = $2 and channel = $3 and status = 'published'
          limit 1`,
        [rollbackReleaseId, input.component, channel],
      );
      if (!rollback.rows[0]) {
        throw new UpdateControlPlaneError(
          409,
          'INVALID_ROLLBACK_RELEASE',
          'Release de rollback deve estar publicada no mesmo componente e canal.',
        );
      }
    }
    const artifactSize =
      input.artifactSize == null || !Number.isFinite(Number(input.artifactSize))
        ? null
        : Number(input.artifactSize);
    try {
      const result = await pool.queryMaster(
        `insert into public.master_releases (
           id, component, version, channel, changelog, artifact_url, sha256,
           signature, signature_algorithm, signer_key_id, artifact_size,
           min_supported_version, rollback_release_id, created_by, created_by_email
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         returning *`,
        [
          id('rel'),
          input.component,
          input.version.trim(),
          channel,
          input.changelog?.trim() ?? '',
          artifactUrl,
          sha256,
          signature,
          signatureAlgorithm,
          signerKeyId,
          artifactSize,
          nullable(input.minSupportedVersion),
          rollbackReleaseId,
          actor.userId ?? null,
          actor.email ?? null,
        ],
      );
      return releaseFromRow(result.rows[0] as Row);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        throw new UpdateControlPlaneError(
          409,
          'RELEASE_ALREADY_EXISTS',
          'Esta versão já existe no componente e canal.',
        );
      }
      throw error;
    }
  },

  async setReleaseStatus(
    releaseId: string,
    status: 'published' | 'withdrawn',
  ): Promise<MasterRelease> {
    const current = await pool.queryMaster(
      `select * from public.master_releases where id = $1 limit 1`,
      [releaseId],
    );
    const row = current.rows[0] as Row | undefined;
    if (!row) {
      throw new UpdateControlPlaneError(404, 'RELEASE_NOT_FOUND', 'Release não encontrada.');
    }
    if (status === 'published') {
      assertReleasePublishable(row);
    }
    const result = await pool.queryMaster(
      `update public.master_releases
          set status = $2,
              published_at = case when $2 = 'published' then coalesce(published_at, now())
                                  else published_at end,
              updated_at = now()
        where id = $1
        returning *`,
      [releaseId, status],
    );
    return releaseFromRow(result.rows[0] as Row);
  },

  async listInstallations(): Promise<MasterInstallation[]> {
    const result = await pool.queryMaster(
      `select i.*,
              latest.version as latest_version,
              active.id as active_request_id,
              active.status as active_request_status,
              coalesce(last_done.completed_at, i.updated_at) as last_update_at
         from public.master_installations i
         left join lateral (
           select r.id, r.version
             from public.master_releases r
            where r.component = i.component
              and r.channel = i.channel
              and r.status = 'published'
            order by r.published_at desc nulls last, r.created_at desc
            limit 1
         ) latest on true
         left join lateral (
           select u.id, u.status
             from public.master_update_requests u
            where u.installation_id = i.id
              and u.status in ('requested','approved','manual_required')
            order by u.created_at desc
            limit 1
         ) active on true
         left join lateral (
           select u.completed_at
             from public.master_update_requests u
            where u.installation_id = i.id
              and u.status = 'completed'
            order by u.completed_at desc nulls last
            limit 1
         ) last_done on true
        order by i.company_name, i.component`,
    );
    return result.rows.map((row) => installationFromRow(row as Row));
  },

  async upsertInstallation(input: {
    companyId: string;
    companyName: string;
    mode: InstallationMode;
    component: ReleaseComponent;
    channel?: ReleaseChannel;
    reportedVersion?: string | null;
    lastSeenAt?: string | null;
    source?: MasterInstallation['source'];
  }): Promise<MasterInstallation> {
    if (!text(input.companyId) || !text(input.companyName)) {
      throw new UpdateControlPlaneError(
        400,
        'INVALID_INSTALLATION',
        'Empresa e ID da empresa são obrigatórios.',
      );
    }
    if (!MODES.has(input.mode) || !COMPONENTS.has(input.component)) {
      throw new UpdateControlPlaneError(400, 'INVALID_INSTALLATION', 'Modo ou componente inválido.');
    }
    const channel = input.channel ?? 'stable';
    if (!CHANNELS.has(channel)) {
      throw new UpdateControlPlaneError(400, 'INVALID_CHANNEL', 'Canal inválido.');
    }
    const reportedVersion = nullable(input.reportedVersion);
    if (reportedVersion && !isValidSemver(reportedVersion)) {
      throw new UpdateControlPlaneError(
        400,
        'INVALID_REPORTED_VERSION',
        'Versão reportada deve seguir SemVer.',
      );
    }
    const result = await pool.queryMaster(
      `insert into public.master_installations (
         id, company_id, company_name, mode, component, channel,
         reported_version, last_seen_at, source
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (company_id, component) do update set
         company_name = excluded.company_name,
         mode = excluded.mode,
         channel = excluded.channel,
         reported_version = excluded.reported_version,
         last_seen_at = excluded.last_seen_at,
         source = excluded.source,
         updated_at = now()
       returning *`,
      [
        id('ins'),
        input.companyId.trim(),
        input.companyName.trim(),
        input.mode,
        input.component,
        channel,
        reportedVersion,
        input.lastSeenAt ?? null,
        input.source ?? 'manual',
      ],
    );
    return installationFromRow({
      ...(result.rows[0] as Row),
      latest_version: null,
      last_update_at: (result.rows[0] as Row).updated_at,
    });
  },

  async listRequests(): Promise<MasterUpdateRequest[]> {
    const result = await pool.queryMaster(
      `select u.*, i.company_name, i.component
         from public.master_update_requests u
         join public.master_installations i on i.id = u.installation_id
        order by u.created_at desc`,
    );
    return result.rows.map((row) => requestFromRow(row as Row));
  },

  async createRequest(
    input: {
      installationId: string;
      releaseId: string;
      kind?: UpdateRequestKind;
      reason?: string | null;
    },
    actor: Actor,
  ): Promise<MasterUpdateRequest> {
    const context = await pool.queryMaster(
      `select i.*, r.version as release_version, r.component as release_component,
              r.channel as release_channel, r.status as release_status
         from public.master_installations i
         join public.master_releases r on r.id = $2
        where i.id = $1`,
      [input.installationId, input.releaseId],
    );
    const row = context.rows[0] as Row | undefined;
    if (!row) {
      throw new UpdateControlPlaneError(
        404,
        'INSTALLATION_OR_RELEASE_NOT_FOUND',
        'Instalação ou release não encontrada.',
      );
    }
    if (row.release_status !== 'published') {
      throw new UpdateControlPlaneError(
        409,
        'RELEASE_NOT_PUBLISHED',
        'Somente releases publicadas podem ser selecionadas.',
      );
    }
    if (row.component !== row.release_component || row.channel !== row.release_channel) {
      throw new UpdateControlPlaneError(
        409,
        'RELEASE_NOT_COMPATIBLE',
        'Componente ou canal da release não corresponde à instalação.',
      );
    }
    const kind = input.kind ?? 'update';
    if (kind === 'update' && nullable(row.reported_version)) {
      const comparison = compareSemver(row.reported_version, row.release_version);
      if (comparison != null && comparison >= 0) {
        throw new UpdateControlPlaneError(
          409,
          'INSTALLATION_ALREADY_CURRENT',
          'A instalação já está nesta versão ou em versão superior.',
        );
      }
    }
    const pending = await pool.queryMaster(
      `select id from public.master_update_requests
        where installation_id = $1
          and status in ('requested','approved','manual_required')
        limit 1`,
      [input.installationId],
    );
    if (pending.rows[0]) {
      throw new UpdateControlPlaneError(
        409,
        'UPDATE_REQUEST_ALREADY_ACTIVE',
        'Já existe uma solicitação ativa para esta instalação.',
      );
    }
    const requestId = id('upd');
    const result = await pool.queryMaster(
      `insert into public.master_update_requests (
         id, installation_id, release_id, kind, status, from_version,
         target_version, reason, requested_by, requested_email
       ) values ($1,$2,$3,$4,'requested',$5,$6,$7,$8,$9)
       returning *`,
      [
        requestId,
        input.installationId,
        input.releaseId,
        kind,
        nullable(row.reported_version),
        String(row.release_version),
        nullable(input.reason),
        actor.userId ?? null,
        actor.email ?? null,
      ],
    );
    await appendEvent({
      requestId,
      eventType: kind === 'rollback' ? 'rollback_requested' : 'update_requested',
      toStatus: 'requested',
      message:
        kind === 'rollback'
          ? `Rollback solicitado para ${String(row.release_version)}`
          : `Atualização solicitada para ${String(row.release_version)}`,
      actor,
      metadata: {
        fromVersion: nullable(row.reported_version),
        targetVersion: String(row.release_version),
      },
    });
    return requestFromRow(result.rows[0] as Row);
  },

  async transitionRequest(
    requestId: string,
    nextStatus: UpdateRequestStatus,
    actor: Actor,
    message?: string | null,
  ): Promise<MasterUpdateRequest> {
    const currentResult = await pool.queryMaster(
      `select u.*, i.company_name, i.component
         from public.master_update_requests u
         join public.master_installations i on i.id = u.installation_id
        where u.id = $1`,
      [requestId],
    );
    const currentRow = currentResult.rows[0] as Row | undefined;
    if (!currentRow) {
      throw new UpdateControlPlaneError(404, 'UPDATE_REQUEST_NOT_FOUND', 'Solicitação não encontrada.');
    }
    const current = currentRow.status as UpdateRequestStatus;
    if (AGENT_ONLY_STATUSES.has(nextStatus) && nextStatus !== 'manual_required') {
      // completed/failed: somente o agente. manual_required: somente o claim do agente.
      throw new UpdateControlPlaneError(
        403,
        nextStatus === 'completed' ? 'AGENT_ONLY_COMPLETION' : 'AGENT_ONLY_TRANSITION',
        nextStatus === 'completed'
          ? 'Somente o Updater Agent pode marcar a atualização como completed.'
          : `A transição para ${nextStatus} é exclusiva do Updater Agent.`,
      );
    }
    if (nextStatus === 'manual_required') {
      throw new UpdateControlPlaneError(
        403,
        'AGENT_ONLY_CLAIM',
        'prepare_manual foi descontinuado. O Updater Agent faz claim após approve.',
      );
    }
    if (!MASTER_REQUEST_TRANSITIONS[current]?.includes(nextStatus)) {
      throw new UpdateControlPlaneError(
        409,
        'INVALID_UPDATE_TRANSITION',
        `Transição ${current} → ${nextStatus} não permitida pelo Painel Master.`,
      );
    }
    const result = await pool.queryMaster(
      `update public.master_update_requests
          set status = $2,
              approved_by = case when $2 = 'approved' then $3 else approved_by end,
              approved_at = case when $2 = 'approved' then now() else approved_at end,
              updated_at = now()
        where id = $1
        returning *`,
      [requestId, nextStatus, actor.userId ?? null],
    );
    // completed/failed + reported_version: gravados apenas pelo UpdateAgentService.report
    await appendEvent({
      requestId,
      eventType: `request_${nextStatus}`,
      fromStatus: current,
      toStatus: nextStatus,
      message: nullable(message) ?? `Solicitação alterada de ${current} para ${nextStatus}`,
      actor,
    });
    return requestFromRow({ ...currentRow, ...(result.rows[0] as Row) });
  },

  async listHistory(
    limit = 200,
    filters?: {
      requestId?: string | null;
      installationId?: string | null;
    },
  ): Promise<MasterUpdateEvent[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const requestId = filters?.requestId?.trim() || null;
    const installationId = filters?.installationId?.trim() || null;
    const result = await pool.queryMaster(
      `select e.*, i.company_name, i.component, u.from_version, u.target_version
         from public.master_update_events e
         join public.master_update_requests u on u.id = e.request_id
         join public.master_installations i on i.id = u.installation_id
        where ($2::text is null or e.request_id = $2)
          and ($3::text is null or u.installation_id = $3)
        order by e.created_at desc
        limit $1`,
      [safeLimit, requestId, installationId],
    );
    return result.rows.map((row) => eventFromRow(row as Row));
  },

  async getCentralSnapshot(currentPlatformVersion?: string | null) {
    const [releases, installations, requests] = await Promise.all([
      this.listReleases(),
      this.listInstallations(),
      this.listRequests(),
    ]);
    return composeUpdatesCentral({
      releases,
      installations,
      requests,
      currentPlatformVersion: currentPlatformVersion ?? null,
    });
  },
};

