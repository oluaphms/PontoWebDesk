import type { Request, Response } from 'express';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';

/** GET /api/master/tenants — fonte oficial TenantManager / PostgreSQL. */
export async function getMasterTenantsController(_req: Request, res: Response): Promise<void> {
  try {
    const tenants = await MasterPlatformService.getTenants().list();
    res.json({
      ok: true,
      tenants,
      count: tenants.length,
      persistence: MasterPlatformService.getPersistence(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'master_tenants_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
