import type { Request, Response } from 'express';
import { insertPunchBatchSafe, insertPunchSafe } from '../services/punchService.js';

export async function createPunchController(req: Request, res: Response): Promise<void> {
  try {
    const result = await insertPunchSafe(req.body || {});
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[PUNCH]', e);
    res.status(500).json({ ok: false, error: 'punch_failed' });
  }
}

export async function createPunchBatchController(req: Request, res: Response): Promise<void> {
  try {
    const punches = Array.isArray(req.body?.punches) ? req.body.punches : [];
    const results = await insertPunchBatchSafe(punches);
    res.json({ ok: true, results });
  } catch (e) {
    console.error('[PUNCH BATCH]', e);
    res.status(500).json({ ok: false, error: 'punch_batch_failed', results: [] });
  }
}

