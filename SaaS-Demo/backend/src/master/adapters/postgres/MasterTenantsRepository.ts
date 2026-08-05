/**
 * MasterTenantsRepository — persistência PostgreSQL de ManagedTenant.
 * Implementa TenantManagerStore. InMemory permanece para testes.
 */
import type { ManagedTenant } from '../../tenantManager/tenantManager.types.js';
import type { TenantManagerStore } from '../../tenantManager/ports/TenantManagerStore.js';
import {
  asJson,
  jsonParam,
  masterSql,
  toIso,
  toIsoRequired,
  type MasterSqlQuery,
} from './masterSql.js';

type TenantRow = {
  id: string;
  operational_company_id: string | null;
  plan: string;
  status: string;
  mode: string;
  gateway: string;
  installation_type: string | null;
  domain: string;
  company_name: string;
  company_document: string | null;
  company_trade_name: string | null;
  admin_name: string;
  admin_email: string;
  admin_user_id: string | null;
  license_key: string | null;
  license_tier: string | null;
  license_local_bound: boolean;
  license_expires_at: Date | string | null;
  storage_driver: string;
  storage_bucket: string | null;
  storage_prefix: string | null;
  storage_max_gb: number | null;
  storage_meta: unknown;
  meta: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapRow(row: TenantRow): ManagedTenant {
  const mode = row.mode as ManagedTenant['mode'];
  const installationType =
    row.installation_type === 'ON_PREMISE' || row.installation_type === 'SAAS_WEB'
      ? row.installation_type
      : mode === 'LOCAL'
        ? 'ON_PREMISE'
        : 'SAAS_WEB';
  return {
    id: row.id,
    operationalCompanyId: row.operational_company_id,
    plan: row.plan as ManagedTenant['plan'],
    status: row.status as ManagedTenant['status'],
    mode,
    gateway: 'none',
    installationType,
    domain: row.domain,
    company: {
      name: row.company_name,
      document: row.company_document,
      tradeName: row.company_trade_name,
    },
    admin: {
      name: row.admin_name,
      email: row.admin_email,
      userId: row.admin_user_id,
    },
    license: {
      licenseKey: row.license_key,
      tier: row.license_tier,
      localLicenseBound: Boolean(row.license_local_bound),
      expiresAt: toIso(row.license_expires_at),
    },
    storage: {
      driver: row.storage_driver as ManagedTenant['storage']['driver'],
      bucket: row.storage_bucket,
      prefix: row.storage_prefix,
      maxGb: row.storage_max_gb,
      meta: asJson(row.storage_meta),
    },
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    meta: asJson(row.meta),
  };
}

export class MasterTenantsRepository implements TenantManagerStore {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async save(tenant: ManagedTenant): Promise<ManagedTenant> {
    const result = await this.sql<TenantRow>(
      `INSERT INTO public.master_tenants (
         id, plan, status, mode, gateway, installation_type, domain,
         company_name, company_document, company_trade_name,
         admin_name, admin_email, admin_user_id,
         license_key, license_tier, license_local_bound, license_expires_at,
         storage_driver, storage_bucket, storage_prefix, storage_max_gb, storage_meta,
         meta, created_at, updated_at, operational_company_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,
         $11,$12,$13,
         $14,$15,$16,$17,
         $18,$19,$20,$21,$22::jsonb,
         $23::jsonb,$24,$25,$26
       )
       ON CONFLICT (id) DO UPDATE SET
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         mode = EXCLUDED.mode,
         gateway = 'none',
         installation_type = EXCLUDED.installation_type,
         domain = EXCLUDED.domain,
         company_name = EXCLUDED.company_name,
         company_document = EXCLUDED.company_document,
         company_trade_name = EXCLUDED.company_trade_name,
         admin_name = EXCLUDED.admin_name,
         admin_email = EXCLUDED.admin_email,
         admin_user_id = EXCLUDED.admin_user_id,
         license_key = EXCLUDED.license_key,
         license_tier = EXCLUDED.license_tier,
         license_local_bound = EXCLUDED.license_local_bound,
         license_expires_at = EXCLUDED.license_expires_at,
         storage_driver = EXCLUDED.storage_driver,
         storage_bucket = EXCLUDED.storage_bucket,
         storage_prefix = EXCLUDED.storage_prefix,
         storage_max_gb = EXCLUDED.storage_max_gb,
         storage_meta = EXCLUDED.storage_meta,
         meta = EXCLUDED.meta,
         operational_company_id = EXCLUDED.operational_company_id,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        tenant.id,
        tenant.plan,
        tenant.status,
        tenant.mode,
        'none',
        tenant.installationType,
        tenant.domain,
        tenant.company.name,
        tenant.company.document ?? null,
        tenant.company.tradeName ?? null,
        tenant.admin.name,
        tenant.admin.email,
        tenant.admin.userId ?? null,
        tenant.license.licenseKey ?? null,
        tenant.license.tier ?? null,
        tenant.license.localLicenseBound ?? false,
        tenant.license.expiresAt,
        tenant.storage.driver,
        tenant.storage.bucket ?? null,
        tenant.storage.prefix ?? null,
        tenant.storage.maxGb ?? null,
        jsonParam(tenant.storage.meta ?? {}),
        jsonParam(tenant.meta ?? {}),
        tenant.createdAt,
        tenant.updatedAt,
        tenant.operationalCompanyId ?? null,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<ManagedTenant | null> {
    const result = await this.sql<TenantRow>(
      `SELECT * FROM public.master_tenants WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByDomain(domain: string): Promise<ManagedTenant | null> {
    const needle = String(domain || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    const result = await this.sql<TenantRow>(
      `SELECT * FROM public.master_tenants WHERE lower(domain) = $1 LIMIT 1`,
      [needle],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async list(): Promise<ManagedTenant[]> {
    const result = await this.sql<TenantRow>(
      `SELECT * FROM public.master_tenants ORDER BY created_at DESC`,
    );
    return result.rows.map(mapRow);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.sql(`DELETE FROM public.master_tenants WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
