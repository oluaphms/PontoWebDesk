/**
 * Composição da Central de Licenciamento a partir de fontes Master.
 * Não altera auth operacional; enriquecimento somente-leitura + meta da licença.
 */
import { pool } from '../../db/index.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';
import type { Invoice } from '../billingEngine/types.js';
import type { MasterAuditEntry } from '../api/services/audit.service.js';
import type { CompanyLicense } from './types.js';
import type { LicenseCentralRow, LicenseHistoryEntry } from './licenseCentral.types.js';
import { buildCommercialLicenseViewState } from '../license/licenseValidity.js';

function asFiniteInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function historyFromMeta(meta: Readonly<Record<string, unknown>> | undefined): LicenseHistoryEntry[] {
  const raw = meta?.history;
  if (!Array.isArray(raw)) return [];
  const out: LicenseHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const at = typeof row.at === 'string' ? row.at : null;
    const action = typeof row.action === 'string' ? row.action : null;
    if (!at || !action) continue;
    out.push({
      at,
      action,
      reason: typeof row.reason === 'string' ? row.reason : null,
      actorEmail: typeof row.actorEmail === 'string' ? row.actorEmail : null,
    });
  }
  return out;
}

function blockKindFromLicense(
  license: CompanyLicense,
): 'blocked' | 'suspended' | null {
  if (license.status !== 'Bloqueada') return null;
  const metaKind = license.meta?.blockKind;
  if (metaKind === 'suspended' || metaKind === 'blocked') return metaKind;
  const reason = String(license.blockedReason || '').toLowerCase();
  if (reason.includes('suspend')) return 'suspended';
  return 'blocked';
}

export function lastPaidInvoiceForTenant(
  invoices: readonly Invoice[],
  tenantId: string,
  operationalCompanyId?: string | null,
): { at: string | null; status: string | null; amountCents: number | null } {
  const ids = new Set(
    [tenantId, operationalCompanyId].filter(Boolean).map((v) => String(v)),
  );
  let best: Invoice | null = null;
  for (const inv of invoices) {
    if (!inv.tenantId || !ids.has(inv.tenantId)) continue;
    if (inv.status !== 'paid' || !inv.paidAt) continue;
    if (!best || Date.parse(inv.paidAt) > Date.parse(best.paidAt || '')) {
      best = inv;
    }
  }
  if (!best) {
    return { at: null, status: null, amountCents: null };
  }
  return {
    at: best.paidAt,
    status: best.status,
    amountCents: best.amountCents,
  };
}

export async function loadInstalledVersionsByCompany(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const result = await pool.queryMaster<{
      company_id: string;
      reported_version: string | null;
    }>(
      `select distinct on (company_id)
              company_id::text as company_id,
              reported_version
         from public.master_installations
        where reported_version is not null
          and btrim(reported_version) <> ''
        order by company_id, last_seen_at desc nulls last`,
    );
    for (const row of result.rows) {
      if (row.reported_version) {
        map.set(String(row.company_id), String(row.reported_version));
      }
    }
  } catch {
    // Tabela ausente / migration pendente — Central continua sem versão.
  }
  return map;
}

function mergeHistory(
  metaHistory: LicenseHistoryEntry[],
  audit: readonly MasterAuditEntry[],
  licenseId: string,
): LicenseHistoryEntry[] {
  const fromAudit: LicenseHistoryEntry[] = [];
  for (const entry of audit) {
    if (entry.resource !== 'licenses') continue;
    if (entry.message !== licenseId) continue;
    fromAudit.push({
      at: entry.at,
      action: entry.action,
      reason: null,
      actorEmail: entry.actorEmail,
    });
  }
  const merged = [...metaHistory, ...fromAudit];
  merged.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const seen = new Set<string>();
  const out: LicenseHistoryEntry[] = [];
  for (const row of merged) {
    const key = `${row.at}|${row.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= 50) break;
  }
  return out;
}

export function toLicenseCentralRow(input: {
  license: CompanyLicense;
  tenant?: ManagedTenant | null;
  invoices?: readonly Invoice[];
  versionsByCompany?: Map<string, string>;
  audit?: readonly MasterAuditEntry[];
}): LicenseCentralRow {
  const { license, tenant } = input;
  const meta = license.meta || {};
  const payment = lastPaidInvoiceForTenant(
    input.invoices || [],
    license.tenantId,
    tenant?.operationalCompanyId,
  );
  const companyKey =
    tenant?.operationalCompanyId ||
    (license.tenantId.startsWith('tn_') ? null : license.tenantId);
  const installedVersion =
    (companyKey && input.versionsByCompany?.get(companyKey)) ||
    input.versionsByCompany?.get(license.tenantId) ||
    (typeof meta.installedVersion === 'string' ? meta.installedVersion : null);

  const maxEmployees =
    asFiniteInt(meta.maxEmployees) ?? asFiniteInt(meta.maxUsers);
  const maxDevices = asFiniteInt(meta.maxDevices);

  const validity = buildCommercialLicenseViewState({
    startsAt: license.startsAt,
    expiresAt: license.expiresAt,
    tenantStatus: tenant?.status ?? null,
    licenseStatus: license.status,
  });

  return {
    id: license.id,
    tenantId: license.tenantId,
    empresa: license.empresa,
    plan: license.plan,
    tipo: license.mode,
    mode: license.mode,
    licenseKey: tenant?.license?.licenseKey ?? (typeof meta.licenseKey === 'string' ? meta.licenseKey : null),
    issuedAt: license.startsAt,
    startsAt: license.startsAt,
    expiresAt: license.expiresAt,
    lastPaymentAt: payment.at,
    lastPaymentStatus: payment.status,
    lastPaymentAmountCents: payment.amountCents,
    status: license.status,
    isBlocked: license.status === 'Bloqueada' || validity.displayStatus === 'Bloqueada',
    blockedAt: license.blockedAt,
    blockedReason: license.blockedReason,
    blockKind: blockKindFromLicense(license),
    maxEmployees,
    maxDevices,
    installedVersion,
    history: mergeHistory(
      historyFromMeta(meta),
      input.audit || [],
      license.id,
    ),
    rules: license.rules,
    ruleOverrides: license.ruleOverrides,
    createdAt: license.createdAt,
    updatedAt: license.updatedAt,
    meta: license.meta,
    validity,
  };
}

export async function composeLicenseCentral(input: {
  licenses: CompanyLicense[];
  tenantsById: Map<string, ManagedTenant>;
  invoices: readonly Invoice[];
  audit: readonly MasterAuditEntry[];
}): Promise<LicenseCentralRow[]> {
  const versionsByCompany = await loadInstalledVersionsByCompany();
  return input.licenses.map((license) =>
    toLicenseCentralRow({
      license,
      tenant: input.tenantsById.get(license.tenantId) ?? null,
      invoices: input.invoices,
      versionsByCompany,
      audit: input.audit,
    }),
  );
}

export function appendLicenseHistory(
  meta: Readonly<Record<string, unknown>> | undefined,
  entry: LicenseHistoryEntry,
  max = 40,
): Record<string, unknown> {
  const prev = historyFromMeta(meta);
  const next = [entry, ...prev].slice(0, max);
  return {
    ...(meta || {}),
    history: next,
    lastAction: entry.action,
    lastActionAt: entry.at,
  };
}
