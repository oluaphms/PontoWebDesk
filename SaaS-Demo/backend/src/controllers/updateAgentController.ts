import type { Response } from 'express';
import type { UpdateAgentRequest } from '../middlewares/updateAgentAuth.js';
import { UpdateAgentError, UpdateAgentService } from '../updateAgent/UpdateAgentService.js';
import type { AgentHealth, ReportStage } from '../updateAgent/updateAgent.types.js';

const VALID_STAGES: ReportStage[] = [
  'claimed',
  'downloading',
  'verified',
  'backup_completed',
  'installing',
  'restarting',
  'health_check',
  'rolling_back',
  'completed',
  'failed',
];

function sendError(res: Response, error: unknown): void {
  if (error instanceof UpdateAgentError) {
    res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    return;
  }
  const code = (error as { code?: string }).code;
  if (code === '42P01' || code === '42703') {
    res.status(503).json({
      ok: false,
      error: 'UPDATE_AGENT_SCHEMA_REQUIRED',
      message: 'Aplique a migration 023 do protocolo do agente.',
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'UPDATE_AGENT_FAILED',
    message: error instanceof Error ? error.message : String(error),
  });
}

function parseHealth(value: unknown): AgentHealth | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const status = String(v.status ?? '');
  if (status !== 'healthy' && status !== 'degraded' && status !== 'unhealthy') return null;
  const details =
    v.details && typeof v.details === 'object' && !Array.isArray(v.details)
      ? (v.details as Record<string, unknown>)
      : undefined;
  return { status, details };
}

function installationId(req: UpdateAgentRequest): string {
  return String(req.agent?.installationId ?? '');
}

export async function postAgentHeartbeat(req: UpdateAgentRequest, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await UpdateAgentService.heartbeat(installationId(req), {
      machineId: body.machineId as string | undefined,
      hardwareHash: body.hardwareHash as string | undefined,
      currentVersion: body.currentVersion as string | undefined,
      channel: body.channel as 'stable' | 'beta' | undefined,
      agentVersion: body.agentVersion as string | undefined,
      hostname: body.hostname as string | undefined,
      platform: body.platform as string | undefined,
      arch: body.arch as string | undefined,
      health: parseHealth(body.health),
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postAgentClaim(req: UpdateAgentRequest, res: Response): Promise<void> {
  try {
    const execution = await UpdateAgentService.claim(installationId(req));
    res.json({ ok: true, execution });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postAgentReport(req: UpdateAgentRequest, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const stage = String(body.stage ?? '') as ReportStage;
    if (!VALID_STAGES.includes(stage)) {
      res.status(400).json({ ok: false, error: 'INVALID_STAGE', message: 'Estágio inválido.' });
      return;
    }
    const result = await UpdateAgentService.report(installationId(req), {
      executionId: String(body.executionId ?? ''),
      executionToken: String(body.executionToken ?? ''),
      stage,
      currentVersion: body.currentVersion as string | undefined,
      message: body.message as string | undefined,
      errorCode: body.errorCode as string | undefined,
      health: parseHealth(body.health),
      metadata:
        body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : undefined,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
}
