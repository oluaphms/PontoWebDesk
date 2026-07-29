import type { Request, Response } from 'express';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';

/** GET /api/master/payments */
export async function getMasterPaymentsController(_req: Request, res: Response): Promise<void> {
  try {
    const paymentsModule = MasterPlatformService.getDashboard().payments;
    const payments = await paymentsModule.listPayments();
    res.json({
      ok: true,
      provider: paymentsModule.getProviderName(),
      payments,
      gateway: MasterPlatformService.getDashboard().gateway.list(),
      count: payments.length,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'master_payments_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
