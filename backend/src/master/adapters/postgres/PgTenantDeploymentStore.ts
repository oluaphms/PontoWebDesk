/**
 * Store PostgreSQL de deployments por tenant (Control Plane).
 * Payload jsonb preserva o shape TenantDeployment sem breaking change.
 */
import type { TenantDeployment } from '../../deploymentManager/types.js';
import type { TenantDeploymentStore } from '../../deploymentManager/ports/TenantDeploymentStore.js';
import {
  asJson,
  jsonParam,
  masterSql,
  toIsoRequired,
  type MasterSqlQuery,
} from './masterSql.js';

type Row = {
  id: string;
  tenant_id: string;
  empresa: string;
  mode: string;
  payload: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapRow(row: Row): TenantDeployment {
  const payload = asJson(row.payload) as unknown as TenantDeployment;
  return {
    ...payload,
    id: row.id,
    tenantId: row.tenant_id,
    empresa: row.empresa || payload.empresa,
    mode: (row.mode || payload.mode) as TenantDeployment['mode'],
    createdAt: payload.createdAt || toIsoRequired(row.created_at),
    updatedAt: payload.updatedAt || toIsoRequired(row.updated_at),
  };
}

export class PgTenantDeploymentStore implements TenantDeploymentStore {
  readonly persistence = 'postgres' as const;

  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async list(): Promise<TenantDeployment[]> {
    const result = await this.sql<Row>(
      `SELECT * FROM public.master_tenant_deployments ORDER BY updated_at DESC`,
    );
    return result.rows.map(mapRow);
  }

  async get(id: string): Promise<TenantDeployment | null> {
    const result = await this.sql<Row>(
      `SELECT * FROM public.master_tenant_deployments WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async getByTenantId(tenantId: string): Promise<TenantDeployment | null> {
    const result = await this.sql<Row>(
      `SELECT * FROM public.master_tenant_deployments WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async save(row: TenantDeployment): Promise<TenantDeployment> {
    const result = await this.sql<Row>(
      `INSERT INTO public.master_tenant_deployments (
         id, tenant_id, empresa, mode, payload, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5::jsonb,$6,$7
       )
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         empresa = EXCLUDED.empresa,
         mode = EXCLUDED.mode,
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        row.id,
        row.tenantId,
        row.empresa,
        row.mode,
        jsonParam(row),
        row.createdAt,
        row.updatedAt,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.sql(
      `DELETE FROM public.master_tenant_deployments WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async clear(): Promise<void> {
    await this.sql(`DELETE FROM public.master_tenant_deployments`);
  }
}
