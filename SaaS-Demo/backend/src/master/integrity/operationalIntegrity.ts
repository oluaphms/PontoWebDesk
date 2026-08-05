/**
 * Auditoria de integridade estrutural Master ↔ Operacional.
 * Somente leitura — não altera dados nem regras de negócio.
 */
import { pool } from '../../db/index.js';

export type IntegrityFindingKind =
  | 'tenant_missing_company'
  | 'company_missing_tenant'
  | 'user_missing_company'
  | 'license_missing_tenant'
  | 'subscription_missing_tenant'
  | 'invalid_operational_company_id';

export type IntegrityFinding = {
  kind: IntegrityFindingKind;
  severity: 'critical' | 'high' | 'medium';
  id: string;
  relatedId?: string | null;
  detail: Record<string, unknown>;
};

export type OperationalIntegrityReport = {
  generatedAt: string;
  totals: {
    companies: number;
    tenants: number;
    users: number;
    licenses: number;
    subscriptions: number;
  };
  counts: Record<IntegrityFindingKind, number>;
  findings: IntegrityFinding[];
  ok: boolean;
};

async function countTrusted(sql: string): Promise<number> {
  const r = await pool.queryTrustedBootstrap<{ n: number }>(sql);
  return Number(r.rows[0]?.n ?? 0);
}

async function countMaster(sql: string): Promise<number> {
  const r = await pool.queryMaster<{ n: number }>(sql);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Relatório consolidado de inconsistências estruturais.
 */
export async function runOperationalIntegrityAudit(): Promise<OperationalIntegrityReport> {
  const findings: IntegrityFinding[] = [];

  const orphanTenants = await pool.queryMaster<{
    tenant_id: string;
    company_id: string | null;
    company_name: string | null;
    tenant_status: string | null;
    plan: string | null;
    admin_email: string | null;
  }>(
    `select t.id::text as tenant_id,
            t.operational_company_id::text as company_id,
            t.company_name,
            t.status as tenant_status,
            t.plan,
            t.admin_email
       from public.master_tenants t
      where t.operational_company_id is not null
        and not exists (
          select 1 from public.companies c
           where c.id::text = t.operational_company_id::text
        )
      order by t.updated_at desc nulls last`,
  );
  for (const row of orphanTenants.rows) {
    findings.push({
      kind: 'tenant_missing_company',
      severity: 'critical',
      id: row.tenant_id,
      relatedId: row.company_id,
      detail: row,
    });
  }

  const invalidOpIds = await pool.queryMaster<{
    tenant_id: string;
    company_id: string | null;
    company_name: string | null;
  }>(
    `select t.id::text as tenant_id,
            t.operational_company_id::text as company_id,
            t.company_name
       from public.master_tenants t
      where t.operational_company_id is null
         or btrim(t.operational_company_id::text) = ''`,
  );
  for (const row of invalidOpIds.rows) {
    findings.push({
      kind: 'invalid_operational_company_id',
      severity: 'high',
      id: row.tenant_id,
      relatedId: row.company_id,
      detail: row,
    });
  }

  const orphanCompanies = await pool.queryTrustedBootstrap<{
    company_id: string;
    name: string | null;
  }>(
    `select c.id::text as company_id, coalesce(c.name, c.nome) as name
       from public.companies c
      where not exists (
        select 1 from public.master_tenants t
         where t.operational_company_id::text = c.id::text
      )`,
  );
  for (const row of orphanCompanies.rows) {
    findings.push({
      kind: 'company_missing_tenant',
      severity: 'medium',
      id: row.company_id,
      relatedId: null,
      detail: row,
    });
  }

  const orphanUsers = await pool.queryTrustedBootstrap<{
    user_id: string;
    email: string | null;
    company_id: string | null;
    role: string | null;
    status: string | null;
  }>(
    `select u.id::text as user_id,
            u.email,
            u.company_id::text as company_id,
            u.role,
            u.status
       from public.users u
      where u.company_id is not null
        and not exists (
          select 1 from public.companies c where c.id::text = u.company_id::text
        )`,
  );
  for (const row of orphanUsers.rows) {
    findings.push({
      kind: 'user_missing_company',
      severity: 'high',
      id: row.user_id,
      relatedId: row.company_id,
      detail: row,
    });
  }

  const orphanLicenses = await pool.queryMaster<{
    license_id: string;
    tenant_id: string | null;
    status: string | null;
  }>(
    `select l.id::text as license_id,
            l.tenant_id::text as tenant_id,
            l.status
       from public.master_licenses l
      where l.tenant_id is null
         or not exists (
           select 1 from public.master_tenants t where t.id::text = l.tenant_id::text
         )`,
  );
  for (const row of orphanLicenses.rows) {
    findings.push({
      kind: 'license_missing_tenant',
      severity: 'critical',
      id: row.license_id,
      relatedId: row.tenant_id,
      detail: row,
    });
  }

  let orphanSubs: { rows: Array<{ subscription_id: string; tenant_id: string | null; status: string | null }> } =
    { rows: [] };
  try {
    orphanSubs = await pool.queryMaster(
      `select s.id::text as subscription_id,
              s.tenant_id::text as tenant_id,
              s.status
         from public.master_subscriptions s
        where s.tenant_id is null
           or not exists (
             select 1 from public.master_tenants t where t.id::text = s.tenant_id::text
           )`,
    );
  } catch {
    orphanSubs = { rows: [] };
  }
  for (const row of orphanSubs.rows) {
    findings.push({
      kind: 'subscription_missing_tenant',
      severity: 'critical',
      id: row.subscription_id,
      relatedId: row.tenant_id,
      detail: row,
    });
  }

  const counts: Record<IntegrityFindingKind, number> = {
    tenant_missing_company: 0,
    company_missing_tenant: 0,
    user_missing_company: 0,
    license_missing_tenant: 0,
    subscription_missing_tenant: 0,
    invalid_operational_company_id: 0,
  };
  for (const f of findings) counts[f.kind] += 1;

  const totals = {
    companies: await countTrusted(`select count(*)::int as n from public.companies`),
    tenants: await countMaster(`select count(*)::int as n from public.master_tenants`),
    users: await countTrusted(`select count(*)::int as n from public.users`),
    licenses: await countMaster(`select count(*)::int as n from public.master_licenses`),
    subscriptions: await countMaster(
      `select count(*)::int as n from public.master_subscriptions`,
    ).catch(() => 0),
  };

  return {
    generatedAt: new Date().toISOString(),
    totals,
    counts,
    findings,
    ok:
      counts.tenant_missing_company === 0 &&
      counts.user_missing_company === 0 &&
      counts.license_missing_tenant === 0 &&
      counts.subscription_missing_tenant === 0 &&
      counts.invalid_operational_company_id === 0,
  };
}

export function formatOperationalIntegrityReport(report: OperationalIntegrityReport): string {
  const lines: string[] = [
    '=== Auditoria de integridade Master ↔ Operacional ===',
    `generatedAt: ${report.generatedAt}`,
    `ok: ${report.ok}`,
    `totals: ${JSON.stringify(report.totals)}`,
    `counts: ${JSON.stringify(report.counts)}`,
  ];
  if (report.findings.length === 0) {
    lines.push('findings: (nenhum)');
  } else {
    lines.push('findings:');
    for (const f of report.findings) {
      lines.push(`  - [${f.severity}] ${f.kind} id=${f.id} related=${f.relatedId ?? '-'} ${JSON.stringify(f.detail)}`);
    }
  }
  return lines.join('\n');
}
