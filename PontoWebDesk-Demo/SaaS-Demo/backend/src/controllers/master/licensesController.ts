import type { Request, Response } from 'express';
import { MasterError } from '../../master/errors.js';
import type { LocalLicenseRecord } from '../../master/localLicense/localLicense.types.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';

export type MasterLocalLicenseView = {
  machineId: string;
  licenseKey: string;
  hardwareHash: string;
  activationDate: string;
  expirationDate: string | null;
  heartbeat: string;
  plan: string | null;
  empresa: string;
  licenca: string;
  validade: string | null;
  offline: boolean;
  ultimoHeartbeat: string;
  prompt: string;
  revoked: boolean;
  remainingDays: number | null;
  validationStatus: string;
};

function readPrompt(meta?: Readonly<Record<string, unknown>>): string {
  const raw = meta?.prompt ?? meta?.aiPrompt ?? meta?.systemPrompt;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return '—';
}

function readEmpresa(record: LocalLicenseRecord): string {
  const meta = record.meta || {};
  for (const key of ['empresa', 'companyName', 'company', 'tenantName'] as const) {
    const v = meta[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  if (typeof meta.tenantId === 'string' && meta.tenantId.trim()) return meta.tenantId;
  return 'Instalação local';
}

function remainingDays(expirationDate: string | null, now = Date.now()): number | null {
  if (!expirationDate) return null;
  const exp = Date.parse(expirationDate);
  if (!Number.isFinite(exp)) return null;
  return Math.ceil((exp - now) / 86_400_000);
}

async function toView(record: LocalLicenseRecord): Promise<MasterLocalLicenseView> {
  const mgr = MasterPlatformService.getLocalLicense();
  const revoked = mgr.isRevoked(record);
  const validation = await mgr.validateOffline(record.machineId, record.hardwareHash);
  return {
    machineId: record.machineId,
    licenseKey: record.licenseKey,
    hardwareHash: record.hardwareHash,
    activationDate: record.activationDate,
    expirationDate: record.expirationDate,
    heartbeat: record.heartbeat,
    plan: record.plan ?? null,
    empresa: readEmpresa(record),
    licenca: record.licenseKey,
    validade: record.expirationDate,
    offline: record.meta?.offline !== false,
    ultimoHeartbeat: record.heartbeat,
    prompt: readPrompt(record.meta),
    revoked,
    remainingDays: remainingDays(record.expirationDate),
    validationStatus: revoked ? 'revoked' : validation.status,
  };
}

function sendMasterError(res: Response, error: unknown): void {
  if (error instanceof MasterError) {
    const status =
      error.code === 'MASTER_NOT_FOUND'
        ? 404
        : error.code === 'MASTER_CONFLICT'
          ? 409
          : error.code === 'MASTER_INVALID'
            ? 400
            : 500;
    res.status(status).json({
      ok: false,
      error: error.code,
      message: error.message,
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'master_licenses_failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

type LocalLicenseAction = 'renew' | 'revoke';

/** POST /api/master/licenses/local/:machineId/actions/:action */
export async function postMasterLocalLicenseActionController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const machineId = String(req.params.machineId || '').trim();
    const action = String(req.params.action || '').trim() as LocalLicenseAction;
    if (!machineId) {
      res.status(400).json({ ok: false, error: 'invalid_id', message: 'machineId is required' });
      return;
    }

    const mgr = MasterPlatformService.getLocalLicense();
    let record: LocalLicenseRecord;

    switch (action) {
      case 'renew': {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          durationDays?: number;
        };
        record = await mgr.renew(machineId, { durationDays: body.durationDays });
        break;
      }
      case 'revoke':
        record = await mgr.revoke(machineId);
        break;
      default:
        res.status(400).json({
          ok: false,
          error: 'invalid_action',
          message: `Ação inválida: ${action}`,
          allowed: ['renew', 'revoke'],
        });
        return;
    }

    res.json({
      ok: true,
      action,
      license: await toView(record),
    });
  } catch (error) {
    sendMasterError(res, error);
  }
}
