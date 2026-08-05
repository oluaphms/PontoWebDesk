import type { Request, Response } from 'express';
import { verifyRepAgentTokenVps } from '../services/repAgentAuthService.js';

function authHeaderToken(req: Request): string {
  const h = String(req.headers.authorization || '').trim();
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return '';
}

function json(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

/**
 * GET /api/rep/agent-version — infraestrutura de auto-update assinado.
 */
export async function repAgentVersionController(req: Request, res: Response): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  const token = authHeaderToken(req);
  const deviceId = String(req.query.device_id || '').trim();
  if (deviceId) {
    const auth = await verifyRepAgentTokenVps(token, deviceId);
    if (!auth.ok) {
      json(res, 401, { ok: false, error: auth.code || 'unauthorized' });
      return;
    }
  } else if (!token) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  const version = String(process.env.REP_AGENT_LATEST_VERSION || '1.0.0').trim();
  const minSupported = String(process.env.REP_AGENT_MIN_SUPPORTED_VERSION || version).trim();
  const downloadUrl = String(process.env.REP_AGENT_DOWNLOAD_URL || '').trim();
  const sha256 = String(process.env.REP_AGENT_SHA256 || '').trim();

  json(res, 200, {
    ok: true,
    version,
    latest_version: version,
    min_supported_version: minSupported,
    download_url: downloadUrl || null,
    sha256: sha256 || null,
    signature_kind: 'sha256+authenticode',
    release_notes: process.env.REP_AGENT_RELEASE_NOTES || null,
  });
}
