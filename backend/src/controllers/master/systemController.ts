import type { Request, Response } from 'express';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';

/** GET /api/master/system */
export async function getMasterSystemController(_req: Request, res: Response): Promise<void> {
  try {
    const snapshot = await MasterPlatformService.getSystemSnapshot();
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'master_system_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
