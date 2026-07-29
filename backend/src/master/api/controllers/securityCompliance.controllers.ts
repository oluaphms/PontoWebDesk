import type { Response } from 'express';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import { SecurityComplianceService } from '../../security/SecurityComplianceService.js';

export async function getSecurityCompliance(
  _req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const compliance = await SecurityComplianceService.snapshot();
    res.json({ ok: true, compliance });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao avaliar conformidade.';
    res.status(500).json({
      ok: false,
      code: 'SECURITY_COMPLIANCE_FAILED',
      error: message,
      message,
    });
  }
}
