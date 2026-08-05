import { pool } from '../db/index.js';
import {
  DEFAULT_PASSWORD_POLICY,
  passwordPolicyFromRow,
  type PasswordPolicyConfig,
} from '../security/passwords/passwordPolicy.js';

export async function loadPasswordPolicyForCompany(companyId: string): Promise<PasswordPolicyConfig> {
  const cid = String(companyId || '').trim();
  if (!cid) return DEFAULT_PASSWORD_POLICY;

  try {
    const hasUpper = await pool.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'global_settings' and column_name = 'require_uppercase'
        limit 1`,
    );
    const cols = hasUpper.rowCount
      ? `password_min_length, require_uppercase, require_lowercase, require_numbers, require_special_chars`
      : `password_min_length, require_numbers, require_special_chars`;

    const scoped = await pool.query(
      `select ${cols}
         from public.global_settings
        where company_id::text = $1
        order by updated_at desc nulls last, created_at desc nulls last
        limit 1`,
      [cid],
    );
    if (scoped.rows[0]) {
      return passwordPolicyFromRow(scoped.rows[0] as Record<string, unknown>);
    }

    const legacy = await pool.query(
      `select ${cols}
         from public.global_settings
        order by updated_at desc nulls last, created_at desc nulls last
        limit 1`,
    );
    if (legacy.rows[0]) {
      return passwordPolicyFromRow(legacy.rows[0] as Record<string, unknown>);
    }
  } catch {
    /* fallback abaixo */
  }

  return DEFAULT_PASSWORD_POLICY;
}
