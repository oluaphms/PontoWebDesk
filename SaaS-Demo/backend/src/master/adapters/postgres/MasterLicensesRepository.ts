/**
 * MasterLicensesRepository — persistência PostgreSQL do License Manager.
 * Implementa LicenseManagerStore. InMemory permanece para testes.
 */
import type { CompanyLicense } from '../../licenseManager/types.js';
import type { LicenseManagerStore } from '../../licenseManager/ports/LicenseManagerStore.js';
import {
  asJson,
  jsonParam,
  masterSql,
  toIso,
  toIsoRequired,
  type MasterSqlQuery,
} from './masterSql.js';

type LicenseRow = {
  id: string;
  tenant_id: string;
  empresa: string;
  mode: string;
  status: string;
  plan: string;
  starts_at: Date | string;
  expires_at: Date | string | null;
  rules: unknown;
  rule_overrides: unknown;
  blocked_at: Date | string | null;
  blocked_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  meta: unknown;
};

function mapRow(row: LicenseRow): CompanyLicense {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    empresa: row.empresa,
    mode: row.mode as CompanyLicense['mode'],
    status: row.status as CompanyLicense['status'],
    plan: row.plan,
    startsAt: toIsoRequired(row.starts_at),
    expiresAt: toIso(row.expires_at),
    rules: asJson(row.rules) as unknown as CompanyLicense['rules'],
    ruleOverrides: asJson(row.rule_overrides) as CompanyLicense['ruleOverrides'],
    blockedAt: toIso(row.blocked_at),
    blockedReason: row.blocked_reason,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    meta: asJson(row.meta),
  };
}

export class MasterLicensesRepository implements LicenseManagerStore {
  readonly persistence = 'postgres' as const;

  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async list(): Promise<CompanyLicense[]> {
    const result = await this.sql<LicenseRow>(
      `SELECT * FROM public.master_licenses ORDER BY created_at DESC`,
    );
    return result.rows.map(mapRow);
  }

  async get(id: string): Promise<CompanyLicense | null> {
    const result = await this.sql<LicenseRow>(
      `SELECT * FROM public.master_licenses WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async getByTenantId(tenantId: string): Promise<CompanyLicense | null> {
    const id = String(tenantId || '').trim();
    if (!id) return null;
    const digits = id.replace(/\D/g, '');
    // Aceita vínculo legado: tenant_id gravado como CNPJ (formatado ou só dígitos).
    const result = await this.sql<LicenseRow>(
      `SELECT * FROM public.master_licenses
        WHERE tenant_id = $1
           OR ($2 <> '' AND regexp_replace(tenant_id, '[^0-9]', '', 'g') = $2)
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
      [id, digits.length >= 8 ? digits : ''],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async save(row: CompanyLicense): Promise<CompanyLicense> {
    const result = await this.sql<LicenseRow>(
      `INSERT INTO public.master_licenses (
         id, tenant_id, empresa, mode, status, plan,
         starts_at, expires_at, rules, rule_overrides,
         blocked_at, blocked_reason, created_at, updated_at, meta
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9::jsonb,$10::jsonb,
         $11,$12,$13,$14,$15::jsonb
       )
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         empresa = EXCLUDED.empresa,
         mode = EXCLUDED.mode,
         status = EXCLUDED.status,
         plan = EXCLUDED.plan,
         starts_at = EXCLUDED.starts_at,
         expires_at = EXCLUDED.expires_at,
         rules = EXCLUDED.rules,
         rule_overrides = EXCLUDED.rule_overrides,
         blocked_at = EXCLUDED.blocked_at,
         blocked_reason = EXCLUDED.blocked_reason,
         updated_at = EXCLUDED.updated_at,
         meta = EXCLUDED.meta
       RETURNING *`,
      [
        row.id,
        row.tenantId,
        row.empresa,
        row.mode,
        row.status,
        row.plan,
        row.startsAt,
        row.expiresAt,
        jsonParam(row.rules),
        jsonParam(row.ruleOverrides ?? {}),
        row.blockedAt,
        row.blockedReason,
        row.createdAt,
        row.updatedAt,
        jsonParam(row.meta ?? {}),
      ],
    );
    return mapRow(result.rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.sql(`DELETE FROM public.master_licenses WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async clear(): Promise<void> {
    await this.sql(`DELETE FROM public.master_licenses`);
  }
}
