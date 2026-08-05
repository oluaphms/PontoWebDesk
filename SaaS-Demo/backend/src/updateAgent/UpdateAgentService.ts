import { randomUUID, randomBytes } from 'node:crypto';
import { pool } from '../db/index.js';
import { isValidSemver } from '../master/updates/semver.js';
import type {
  AvailableRequestSummary,
  ClaimResult,
  HeartbeatInput,
  ReleaseManifest,
  ReportInput,
  ReportStage,
} from './updateAgent.types.js';

type Row = Record<string, unknown>;

const LEASE_MINUTES = 30;

/** Solicitações que o agente pode ver/executar: aprovadas ou já claimadas por ele. */
const AGENT_VISIBLE_SQL = `
  (
    u.status = 'approved'
    or (
      u.status = 'manual_required'
      and exists (
        select 1 from public.master_update_executions e
         where e.request_id = u.id
           and e.installation_id = u.installation_id
           and e.finished_at is null
      )
    )
  )
`;

export class UpdateAgentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UpdateAgentError';
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function nullable(value: unknown): string | null {
  const v = String(value ?? '').trim();
  return v || null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function appendEvent(input: {
  requestId: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pool.queryMaster(
    `insert into public.master_update_events (
       id, request_id, event_type, from_status, to_status, message, actor_id, actor_email, metadata
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      id('uev'),
      input.requestId,
      input.eventType,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.message,
      'update-agent',
      'agent@installation.local',
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

function manifestFromRow(row: Row): ReleaseManifest {
  return {
    releaseId: String(row.release_id ?? row.id),
    component: row.release_component as ReleaseManifest['component'],
    channel: row.release_channel as ReleaseManifest['channel'],
    version: String(row.release_version),
    artifactUrl: nullable(row.artifact_url),
    sha256: nullable(row.sha256),
    signature: nullable(row.signature),
    signatureAlgorithm: nullable(row.signature_algorithm),
    signerKeyId: nullable(row.signer_key_id),
    artifactSize: numberOrNull(row.artifact_size),
    rollbackReleaseId: nullable(row.rollback_release_id),
  };
}

export const UpdateAgentService = {
  /**
   * Heartbeat autenticado: registra identidade da máquina, versão real e health.
   * O servidor é a fonte de last_seen_at; nunca confia no relógio do agente.
   */
  async heartbeat(
    installationId: string,
    input: HeartbeatInput,
  ): Promise<{ availableRequest: AvailableRequestSummary; serverTime: string }> {
    const reportedVersion = nullable(input.currentVersion);
    if (reportedVersion && !isValidSemver(reportedVersion)) {
      throw new UpdateAgentError(400, 'INVALID_REPORTED_VERSION', 'currentVersion deve seguir SemVer.');
    }
    const health = input.health ?? null;
    const updated = await pool.queryMaster(
      `update public.master_installations
          set reported_version = coalesce($2, reported_version),
              channel = coalesce($3, channel),
              machine_id = coalesce($4, machine_id),
              hardware_hash = coalesce($5, hardware_hash),
              hostname = coalesce($6, hostname),
              platform = coalesce($7, platform),
              arch = coalesce($8, arch),
              agent_version = coalesce($9, agent_version),
              agent_status = 'online',
              last_health_status = coalesce($10, last_health_status),
              last_health_at = case when $10 is not null then now() else last_health_at end,
              last_health_details = coalesce($11::jsonb, last_health_details),
              last_seen_at = now(),
              source = 'heartbeat',
              updated_at = now()
        where id = $1
        returning id`,
      [
        installationId,
        reportedVersion,
        nullable(input.channel),
        nullable(input.machineId),
        nullable(input.hardwareHash),
        nullable(input.hostname),
        nullable(input.platform),
        nullable(input.arch),
        nullable(input.agentVersion),
        health ? health.status : null,
        health ? JSON.stringify(health.details ?? {}) : null,
      ],
    );
    if (!updated.rows[0]) {
      throw new UpdateAgentError(404, 'INSTALLATION_NOT_FOUND', 'Instalação não encontrada.');
    }

    const req = await pool.queryMaster(
      `select u.id, u.kind, u.target_version, u.from_version
         from public.master_update_requests u
        where u.installation_id = $1
          and ${AGENT_VISIBLE_SQL}
        order by u.created_at desc
        limit 1`,
      [installationId],
    );
    const row = req.rows[0] as Row | undefined;
    const availableRequest: AvailableRequestSummary = row
      ? {
          requestId: String(row.id),
          kind: row.kind as 'update' | 'rollback',
          targetVersion: String(row.target_version),
          fromVersion: nullable(row.from_version),
        }
      : null;

    return { availableRequest, serverTime: new Date().toISOString() };
  },

  /**
   * Claim atômico de uma solicitação aprovada. Garante uma execução ativa por
   * request via índice único parcial. Retorna manifesto assinado da release.
   */
  async claim(installationId: string): Promise<ClaimResult> {
    const context = await pool.queryMaster(
      `select u.id as request_id, u.kind, u.status, u.from_version, u.target_version,
              r.id as release_id, r.component as release_component, r.channel as release_channel,
              r.version as release_version, r.artifact_url, r.sha256, r.signature,
              r.signature_algorithm, r.signer_key_id, r.artifact_size, r.rollback_release_id
         from public.master_update_requests u
         join public.master_releases r on r.id = u.release_id
        where u.installation_id = $1
          and ${AGENT_VISIBLE_SQL}
        order by u.created_at desc
        limit 1`,
      [installationId],
    );
    const row = context.rows[0] as Row | undefined;
    if (!row) return null;

    const requestId = String(row.request_id);

    // Já existe execução ativa? Retorna a mesma (resume idempotente).
    const existing = await pool.queryMaster(
      `select * from public.master_update_executions
        where request_id = $1 and finished_at is null
        limit 1`,
      [requestId],
    );
    if (existing.rows[0]) {
      const ex = existing.rows[0] as Row;
      if (String(ex.installation_id) !== installationId) {
        throw new UpdateAgentError(409, 'EXECUTION_OWNED_BY_OTHER', 'Execução pertence a outra instalação.');
      }
      return {
        requestId,
        executionId: String(ex.id),
        executionToken: String(ex.execution_token),
        leaseExpiresAt: String(ex.lease_expires_at),
        kind: ex.kind as 'update' | 'rollback',
        fromVersion: nullable(ex.from_version),
        targetVersion: String(ex.target_version),
        release: manifestFromRow(row),
      };
    }

    const executionId = id('uex');
    const executionToken = `uex_${randomBytes(20).toString('hex')}`;
    const leaseExpiresAt = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();

    let inserted;
    try {
      inserted = await pool.queryMaster(
        `insert into public.master_update_executions (
           id, request_id, installation_id, execution_token, stage,
           from_version, target_version, kind, lease_expires_at
         ) values ($1,$2,$3,$4,'claimed',$5,$6,$7,$8)
         returning *`,
        [
          executionId,
          requestId,
          installationId,
          executionToken,
          nullable(row.from_version),
          String(row.target_version),
          row.kind,
          leaseExpiresAt,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        // Corrida: outra tentativa criou a execução. Reconsulta e resume.
        return this.claim(installationId);
      }
      throw error;
    }

    // Marca a solicitação como em execução manual (approved → manual_required).
    if (row.status === 'approved') {
      await pool.queryMaster(
        `update public.master_update_requests
            set status = 'manual_required', updated_at = now()
          where id = $1 and status = 'approved'`,
        [requestId],
      );
    }
    await appendEvent({
      requestId,
      eventType: 'agent_claimed',
      fromStatus: String(row.status),
      toStatus: 'manual_required',
      message: `Agente iniciou execução (${String(row.kind)}) para ${String(row.target_version)}`,
      metadata: { executionId, installationId },
    });

    const ex = inserted.rows[0] as Row;
    return {
      requestId,
      executionId,
      executionToken,
      leaseExpiresAt: String(ex.lease_expires_at),
      kind: ex.kind as 'update' | 'rollback',
      fromVersion: nullable(ex.from_version),
      targetVersion: String(ex.target_version),
      release: manifestFromRow(row),
    };
  },

  /**
   * Reporte idempotente por estágio. Só marca a versão instalada como atual
   * após confirmação saudável (completed). Rollback registra result rolled_back.
   */
  async report(installationId: string, input: ReportInput): Promise<{ ok: true; finished: boolean }> {
    const execResult = await pool.queryMaster(
      `select e.*, u.status as request_status
         from public.master_update_executions e
         join public.master_update_requests u on u.id = e.request_id
        where e.id = $1
        limit 1`,
      [input.executionId],
    );
    const exec = execResult.rows[0] as Row | undefined;
    if (!exec) {
      throw new UpdateAgentError(404, 'EXECUTION_NOT_FOUND', 'Execução não encontrada.');
    }
    if (String(exec.installation_id) !== installationId) {
      throw new UpdateAgentError(403, 'EXECUTION_FORBIDDEN', 'Execução não pertence a esta instalação.');
    }
    if (String(exec.execution_token) !== String(input.executionToken)) {
      throw new UpdateAgentError(403, 'EXECUTION_TOKEN_INVALID', 'Token de execução inválido.');
    }

    // Idempotência: execução já finalizada → confirma sem reprocessar.
    if (exec.finished_at) {
      return { ok: true, finished: true };
    }

    const requestId = String(exec.request_id);
    const stage: ReportStage = input.stage;
    const kind = String(exec.kind) as 'update' | 'rollback';
    const isTerminalOk = stage === 'completed';
    const isTerminalFail = stage === 'failed';
    const health = input.health ?? null;

    await pool.queryMaster(
      `update public.master_update_executions
          set stage = $2,
              last_report_at = now(),
              error_code = coalesce($3, error_code),
              result = case
                when $2 = 'completed' and $4 = 'rollback' then 'rolled_back'
                when $2 = 'completed' then 'completed'
                when $2 = 'failed' then 'failed'
                else result end,
              finished_at = case when $2 in ('completed','failed') then now() else finished_at end,
              updated_at = now()
        where id = $1`,
      [input.executionId, stage, nullable(input.errorCode), kind],
    );

    if (health) {
      await pool.queryMaster(
        `update public.master_installations
            set last_health_status = $2,
                last_health_at = now(),
                last_health_details = $3::jsonb,
                updated_at = now()
          where id = $1`,
        [installationId, health.status, JSON.stringify(health.details ?? {})],
      );
    }

    await appendEvent({
      requestId,
      eventType: `agent_${stage}`,
      message: nullable(input.message) ?? `Agente reportou estágio ${stage}`,
      metadata: {
        executionId: input.executionId,
        stage,
        currentVersion: nullable(input.currentVersion),
        errorCode: nullable(input.errorCode),
        ...(input.metadata ?? {}),
      },
    });

    if (isTerminalOk) {
      // Confirmação saudável: instalação assume a versão alvo.
      await pool.queryMaster(
        `update public.master_installations i
            set reported_version = e.target_version,
                target_release_id = u.release_id,
                agent_status = 'online',
                updated_at = now()
           from public.master_update_executions e
           join public.master_update_requests u on u.id = e.request_id
          where e.id = $1 and i.id = e.installation_id`,
        [input.executionId],
      );
      if (String(exec.request_status) === 'manual_required') {
        await pool.queryMaster(
          `update public.master_update_requests
              set status = 'completed', completed_at = now(), updated_at = now()
            where id = $1 and status = 'manual_required'`,
          [requestId],
        );
        await appendEvent({
          requestId,
          eventType: 'request_completed',
          fromStatus: 'manual_required',
          toStatus: 'completed',
          message: kind === 'rollback' ? 'Rollback concluído pelo agente' : 'Atualização concluída pelo agente',
          metadata: { executionId: input.executionId },
        });
      }
      return { ok: true, finished: true };
    }

    if (isTerminalFail) {
      if (String(exec.request_status) === 'manual_required') {
        await pool.queryMaster(
          `update public.master_update_requests
              set status = 'failed', failed_at = now(), updated_at = now()
            where id = $1 and status = 'manual_required'`,
          [requestId],
        );
        await appendEvent({
          requestId,
          eventType: 'request_failed',
          fromStatus: 'manual_required',
          toStatus: 'failed',
          message: nullable(input.message) ?? 'Falha reportada pelo agente',
          metadata: { executionId: input.executionId, errorCode: nullable(input.errorCode) },
        });
      }
      return { ok: true, finished: true };
    }

    return { ok: true, finished: false };
  },
};
