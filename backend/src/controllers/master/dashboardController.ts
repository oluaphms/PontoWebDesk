import type { Request, Response } from 'express';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';

/** GET /api/master/dashboard — summary + Dashboard Executivo (Fase 22). */
export async function getMasterDashboardController(_req: Request, res: Response): Promise<void> {
  try {
    const dashboard = MasterPlatformService.getDashboard();
    const [summary, executive] = await Promise.all([
      dashboard.getSummary(),
      dashboard.getExecutive(),
    ]);
    res.json({
      ok: true,
      modules: dashboard.listModules(),
      summary,
      executive,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'master_dashboard_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
