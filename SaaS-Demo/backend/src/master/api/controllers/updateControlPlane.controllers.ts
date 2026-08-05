import type { Response } from 'express';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import {
  UpdateControlPlaneError,
  UpdateControlPlaneService,
} from '../../updates/UpdateControlPlaneService.js';
import { issueAgentToken } from '../../../updateAgent/agentToken.js';
import type {
  InstallationMode,
  ReleaseChannel,
  ReleaseComponent,
  UpdateRequestKind,
  UpdateRequestStatus,
} from '../../updates/updateControlPlane.types.js';
import { MasterApiServices } from '../services/index.js';

function actor(req: MasterApiRequest) {
  return {
    userId: req.masterAuth?.userId ?? null,
    email: req.masterAuth?.email ?? null,
  };
}

function audit(
  req: MasterApiRequest,
  input: {
    action: string;
    message: string;
    companyId?: string | null;
    companyName?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    meta?: Record<string, unknown>;
  },
): void {
  MasterApiServices.recordAudit(req, {
    action: input.action,
    resource: 'updates',
    message: input.message,
    companyId: input.companyId ?? null,
    companyName: input.companyName ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta,
  });
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof UpdateControlPlaneError) {
    res.status(error.status).json({
      ok: false,
      error: error.code,
      code: error.code,
      message: error.message,
    });
    return;
  }
  const pgCode = (error as { code?: string }).code;
  if (pgCode === '42P01' || pgCode === '42703') {
    res.status(503).json({
      ok: false,
      error: 'MASTER_UPDATE_SCHEMA_REQUIRED',
      code: 'MASTER_UPDATE_SCHEMA_REQUIRED',
      message: 'Aplique a migration 021 do Control Plane de atualizações.',
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'MASTER_UPDATE_CONTROL_PLANE_FAILED',
    code: 'MASTER_UPDATE_CONTROL_PLANE_FAILED',
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function getMasterReleases(
  _req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const releases = await UpdateControlPlaneService.listReleases();
    res.json({ ok: true, releases, count: releases.length, persistence: 'postgres' });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postMasterRelease(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const release = await UpdateControlPlaneService.createRelease(
      {
        component: req.body?.component as ReleaseComponent,
        version: String(req.body?.version ?? ''),
        channel: req.body?.channel as ReleaseChannel | undefined,
        changelog: req.body?.changelog,
        artifactUrl: req.body?.artifactUrl,
        sha256: req.body?.sha256,
        signature: req.body?.signature,
        signatureAlgorithm: req.body?.signatureAlgorithm,
        signerKeyId: req.body?.signerKeyId,
        artifactSize: req.body?.artifactSize != null ? Number(req.body.artifactSize) : null,
        minSupportedVersion: req.body?.minSupportedVersion,
        rollbackReleaseId: req.body?.rollbackReleaseId,
      },
      actor(req),
    );
    audit(req, {
      action: 'UPDATE_RELEASE_CREATED',
      message: `Release criada: ${release.component}@${release.version}`,
      before: null,
      after: {
        id: release.id,
        component: release.component,
        version: release.version,
        channel: release.channel,
        status: release.status,
      },
    });
    res.status(201).json({ ok: true, release });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postMasterReleaseAction(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const action = String(req.params.action ?? '').trim().toLowerCase();
    if (action !== 'publish' && action !== 'withdraw') {
      throw new UpdateControlPlaneError(400, 'INVALID_RELEASE_ACTION', 'Ação de release inválida.');
    }
    const releaseId = String(req.params.id ?? '');
    const release = await UpdateControlPlaneService.setReleaseStatus(
      releaseId,
      action === 'publish' ? 'published' : 'withdrawn',
    );
    audit(req, {
      action: `UPDATE_RELEASE_${action.toUpperCase()}`,
      message: `Release ${action}: ${release.component}@${release.version}`,
      before: { id: releaseId },
      after: { id: release.id, status: release.status, component: release.component, version: release.version },
    });
    res.json({ ok: true, release });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getMasterInstallations(
  _req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const installations = await UpdateControlPlaneService.listInstallations();
    const outdated = installations.filter((row) => row.updateStatus === 'outdated').length;
    res.json({
      ok: true,
      installations,
      count: installations.length,
      outdated,
      unknown: installations.filter((row) => row.updateStatus === 'unknown').length,
      persistence: 'postgres',
    });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postMasterInstallation(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const companyId = String(req.body?.companyId ?? '');
    const companyName = String(req.body?.companyName ?? '');
    const installation = await UpdateControlPlaneService.upsertInstallation({
      companyId,
      companyName,
      mode: req.body?.mode as InstallationMode,
      component: req.body?.component as ReleaseComponent,
      channel: req.body?.channel as ReleaseChannel | undefined,
      reportedVersion: req.body?.reportedVersion,
      lastSeenAt: req.body?.lastSeenAt,
      source: req.body?.source,
    });
    audit(req, {
      action: 'UPDATE_INSTALLATION_UPSERT',
      message: `Instalação upsert: ${companyName || companyId}`,
      companyId,
      companyName: companyName || null,
      before: null,
      after: {
        id: installation.id,
        companyId: installation.companyId,
        component: installation.component,
        reportedVersion: installation.reportedVersion,
        updateStatus: installation.updateStatus,
      },
    });
    res.status(201).json({ ok: true, installation });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postMasterInstallationAgentToken(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const installationId = String(req.params.id ?? '').trim();
    if (!installationId) {
      throw new UpdateControlPlaneError(400, 'INVALID_INSTALLATION', 'Instalação inválida.');
    }
    const { token, tokenId } = await issueAgentToken(installationId, actor(req).userId);
    audit(req, {
      action: 'UPDATE_AGENT_TOKEN_ISSUED',
      message: `Token de agent emitido: ${installationId}`,
      before: null,
      after: { installationId, tokenId, tokenIssued: true },
      meta: { installationId, tokenId },
    });
    // Texto puro exibido uma única vez ao operador; apenas o hash é persistido.
    res.status(201).json({
      ok: true,
      tokenId,
      token,
      note: 'Guarde este token com segurança. Ele não será exibido novamente.',
    });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getMasterUpdateRequests(
  _req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const requests = await UpdateControlPlaneService.listRequests();
    res.json({
      ok: true,
      requests,
      count: requests.length,
      execution: 'agent_after_approval',
    });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postMasterUpdateRequest(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const request = await UpdateControlPlaneService.createRequest(
      {
        installationId: String(req.body?.installationId ?? ''),
        releaseId: String(req.body?.releaseId ?? ''),
        kind: req.body?.kind as UpdateRequestKind | undefined,
        reason: req.body?.reason,
      },
      actor(req),
    );
    audit(req, {
      action: 'UPDATE_REQUEST_CREATED',
      message: `Pedido de update: ${request.id}`,
      companyName: request.companyName ?? null,
      before: null,
      after: {
        id: request.id,
        installationId: request.installationId,
        releaseId: request.releaseId,
        status: request.status,
        kind: request.kind,
      },
    });
    res.status(201).json({
      ok: true,
      request,
      execution: 'agent_after_approval',
      note: 'Após approve, o PontoWebDesk Updater Service (Fase 23) faz claim e executa fora do navegador.',
    });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postMasterUpdateRequestAction(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const action = String(req.params.action ?? '').trim().toLowerCase();
    if (action === 'complete' || action === 'prepare_manual' || action === 'fail') {
      throw new UpdateControlPlaneError(
        403,
        action === 'complete' ? 'AGENT_ONLY_COMPLETION' : 'AGENT_ONLY_EXECUTION',
        action === 'complete'
          ? 'Somente o Updater Agent pode marcar completed.'
          : action === 'prepare_manual'
            ? 'prepare_manual foi descontinuado. Após approve, o Updater Agent faz claim automaticamente.'
            : 'Somente o Updater Agent pode marcar failed. Cancele ou use retry após falha do agente.',
      );
    }
    const statusByAction: Record<string, UpdateRequestStatus> = {
      approve: 'approved',
      cancel: 'cancelled',
      retry: 'approved',
    };
    const status = statusByAction[action];
    if (!status) {
      throw new UpdateControlPlaneError(400, 'INVALID_REQUEST_ACTION', 'Ação inválida.');
    }
    const requestId = String(req.params.id ?? '');
    const request = await UpdateControlPlaneService.transitionRequest(
      requestId,
      status,
      actor(req),
      req.body?.message,
    );
    audit(req, {
      action: `UPDATE_REQUEST_${action.toUpperCase()}`,
      message: `Pedido update ${action}: ${request.id}`,
      companyName: request.companyName ?? null,
      before: { id: requestId },
      after: { id: request.id, status: request.status },
      meta: { message: req.body?.message ?? null },
    });
    res.json({ ok: true, request });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getMasterUpdateHistory(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const limit = Number(req.query.limit ?? 200);
    const events = await UpdateControlPlaneService.listHistory(
      Number.isFinite(limit) ? limit : 200,
      {
        requestId: req.query.requestId ? String(req.query.requestId) : null,
        installationId: req.query.installationId
          ? String(req.query.installationId)
          : null,
      },
    );
    res.json({ ok: true, events, count: events.length, appendOnly: true });
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/updates/central — snapshot operacional da Central de Atualizações. */
export async function getUpdatesCentral(
  _req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const central = await UpdateControlPlaneService.getCentralSnapshot(
      process.env.APP_VERSION ?? process.env.npm_package_version ?? null,
    );
    res.json({
      ok: true,
      central,
      agentOnlyExecution: true,
      note: central.note,
    });
  } catch (error) {
    sendError(res, error);
  }
}

