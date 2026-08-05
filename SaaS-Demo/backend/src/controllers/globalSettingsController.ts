import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { requireCompanyId } from '../utils/authContext.js';
import {
  getGlobalSettingsForCompany,
  upsertGlobalSettingsForCompany,
} from '../services/globalSettingsService.js';
import { logger } from '../logger/logger.js';

export async function getGlobalSettingsController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  try {
    const row = await getGlobalSettingsForCompany(companyId);
    if (!row) {
      res.status(404).json({ ok: false, error: 'not_found', message: 'Configurações não encontradas.' });
      return;
    }
    res.json({ ok: true, success: true, data: row });
  } catch (e) {
    logger.error({
      module: 'globalSettings.controller',
      action: 'GLOBAL_SETTINGS_GET_FAILED',
      companyId,
      message: 'Falha ao ler configurações globais',
      error: e,
    });
    res.status(500).json({ ok: false, error: 'settings_read_failed' });
  }
}

export async function upsertGlobalSettingsController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const raw = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  try {
    const row = await upsertGlobalSettingsForCompany(companyId, raw);
    res.json({ ok: true, success: true, data: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'settings_upsert_failed';
    logger.error({
      module: 'globalSettings.controller',
      action: 'GLOBAL_SETTINGS_UPSERT_FAILED',
      companyId,
      message: 'Falha ao salvar configurações globais',
      error: e,
      meta: { payloadKeys: Object.keys(raw).sort() },
    });
    const status = message === 'not_found' ? 404 : 500;
    res.status(status).json({
      ok: false,
      error: message,
      message:
        message === 'not_found'
          ? 'Configurações não encontradas para esta empresa.'
          : 'Não foi possível salvar as configurações.',
    });
  }
}
