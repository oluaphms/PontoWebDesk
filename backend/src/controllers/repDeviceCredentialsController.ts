import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { pool } from '../db/index.js';
import { requireCompanyId } from '../utils/authContext.js';
import { isAdminRH } from '../utils/accessProfile.js';
import { encryptDeviceCredentialOrThrow } from '../services/deviceCredentialCrypto.js';

function stripRepPasswordFromConfigExtra(extra: unknown): Record<string, unknown> {
  const base =
    extra && typeof extra === 'object' && !Array.isArray(extra)
      ? { ...(extra as Record<string, unknown>) }
      : {};
  delete base.rep_password;
  delete base.password;
  return base;
}

export async function repDeviceCredentialsController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  if (!isAdminRH(req.auth?.role)) {
    res.status(403).json({ ok: false, error: 'forbidden', message: 'Apenas Admin/RH.' });
    return;
  }

  const deviceId = String(req.params.deviceId || '').trim();
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const password = String(body.password || '').trim();
  if (!deviceId || !password) {
    res.status(400).json({ ok: false, error: 'device_id e password são obrigatórios.' });
    return;
  }

  let encrypted;
  try {
    encrypted = encryptDeviceCredentialOrThrow(password);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Falha ao criptografar credencial.';
    res.status(503).json({ ok: false, error: message, code: 'CREDENTIALS_MASTER_KEY_REQUIRED' });
    return;
  }

  const existing = await pool.query(
    `select id::text, config_extra from public.rep_devices where id::text = $1 and company_id::text = $2 limit 1`,
    [deviceId, companyId],
  );
  if ((existing.rowCount ?? 0) === 0) {
    res.status(404).json({ ok: false, error: 'Dispositivo não encontrado.' });
    return;
  }

  const row = existing.rows[0] as { config_extra?: unknown };
  const configExtra = stripRepPasswordFromConfigExtra(row.config_extra);
  if (body.rep_login) {
    configExtra.rep_login = String(body.rep_login).trim() || 'admin';
  }
  configExtra.password_configured = true;

  await pool.query(
    `update public.rep_devices set
      password_encrypted = $3,
      password_iv = $4,
      password_tag = $5,
      senha_encrypted = $3,
      senha_iv = $4,
      senha_tag = $5,
      config_extra = $6::jsonb,
      updated_at = now()
     where id::text = $1 and company_id::text = $2`,
    [deviceId, companyId, encrypted.encrypted, encrypted.iv, encrypted.tag, JSON.stringify(configExtra)],
  );

  res.json({ ok: true, password_configured: true });
}
