/**
 * Tombstone de exclusão intencional de licença Master.
 * Impede discovery/journey de recriar automaticamente após DELETE.
 * Wizard `generate_license` limpa o tombstone (ação explícita).
 */
import { pool } from '../../db/index.js';
import { logger } from '../../logger/logger.js';

const META_KEYS = [
  'licenseIntentionallyDeleted',
  'licenseDeletedAt',
  'licenseDeletedId',
] as const;

export async function markLicenseIntentionallyDeleted(
  tenantId: string,
  licenseId?: string | null,
): Promise<void> {
  const id = String(tenantId || '').trim();
  if (!id) return;
  const patch = {
    licenseIntentionallyDeleted: true,
    licenseDeletedAt: new Date().toISOString(),
    licenseDeletedId: licenseId ? String(licenseId) : null,
  };
  try {
    await pool.queryMaster(
      `UPDATE public.master_commercial_onboardings
          SET license_id = null,
              wizard_meta = coalesce(wizard_meta, '{}'::jsonb) || $2::jsonb,
              updated_at = now()
        WHERE master_tenant_id = $1`,
      [id, JSON.stringify(patch)],
    );
    logger.info({
      module: 'master.license',
      action: 'LICENSE_DELETE_TOMBSTONE',
      message: 'Tombstone de exclusão de licença gravado',
      meta: { tenantId: id, licenseId: licenseId ?? null, result: 'ok' },
    });
  } catch (error) {
    logger.warn({
      module: 'master.license',
      action: 'LICENSE_DELETE_TOMBSTONE_FAILED',
      message: 'Falha ao gravar tombstone de exclusão de licença',
      error,
      meta: { tenantId: id, licenseId: licenseId ?? null, result: 'error' },
    });
  }
}

export async function clearLicenseIntentionallyDeleted(tenantId: string): Promise<void> {
  const id = String(tenantId || '').trim();
  if (!id) return;
  try {
    await pool.queryMaster(
      `UPDATE public.master_commercial_onboardings
          SET wizard_meta = coalesce(wizard_meta, '{}'::jsonb)
                - 'licenseIntentionallyDeleted'
                - 'licenseDeletedAt'
                - 'licenseDeletedId',
              updated_at = now()
        WHERE master_tenant_id = $1`,
      [id],
    );
  } catch {
    /* onboarding ausente — ok */
  }
}

export async function isLicenseIntentionallyDeleted(tenantId: string): Promise<boolean> {
  const id = String(tenantId || '').trim();
  if (!id) return false;
  try {
    const result = await pool.queryMaster<{ wizard_meta: unknown }>(
      `SELECT wizard_meta
         FROM public.master_commercial_onboardings
        WHERE master_tenant_id = $1
        LIMIT 1`,
      [id],
    );
    const meta = result.rows[0]?.wizard_meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
    return (meta as Record<string, unknown>).licenseIntentionallyDeleted === true;
  } catch {
    return false;
  }
}

export function licenseDeletionMetaKeys(): readonly string[] {
  return META_KEYS;
}
