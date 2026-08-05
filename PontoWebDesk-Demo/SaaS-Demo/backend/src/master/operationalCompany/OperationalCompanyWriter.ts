/**
 * Writer canônico de public.companies.
 *
 * Única porta de entrada para INSERT / UPDATE / DELETE / UPSERT em companies.
 * Serviços de domínio (provisioning, journey, projeção, sessão, login) delegam aqui.
 * Controllers e CRUD genérico NÃO escrevem nesta tabela.
 */
import { pool } from '../../db/index.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';
import type { CommercialProjectionSnapshot } from '../commercial/commercialProjection.types.js';

function slugFrom(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export type UpsertOperationalCompanyInput = {
  tenant: ManagedTenant;
  operationalCompanyId: string;
};

/**
 * UPSERT cadastral mínimo a partir do tenant Master (create + repair + journey ensure).
 */
export async function upsertOperationalCompanyFromTenant(
  input: UpsertOperationalCompanyInput,
): Promise<void> {
  const operationalCompanyId = String(input.operationalCompanyId || '').trim();
  const tenant = input.tenant;
  if (!operationalCompanyId) {
    throw new Error('OPERATIONAL_COMPANY_ID_REQUIRED');
  }

  const sql = `INSERT INTO public.companies (
       id, nome, name, slug, cnpj, plan, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,'free',now(),now())
     ON CONFLICT (id) DO UPDATE SET
       nome = EXCLUDED.nome,
       name = EXCLUDED.name,
       cnpj = coalesce(EXCLUDED.cnpj, public.companies.cnpj),
       updated_at = now()`;
  const values = [
    operationalCompanyId,
    tenant.company.name,
    tenant.company.tradeName || tenant.company.name,
    `${slugFrom(tenant.domain || tenant.company.name) || 'empresa'}-${operationalCompanyId.slice(0, 8)}`,
    tenant.company.document ?? null,
  ];
  await pool.queryMaster(sql, values);
}

/** DELETE da linha operacional (rollback / purge Master). */
export async function deleteOperationalCompany(companyId: string): Promise<void> {
  const id = String(companyId || '').trim();
  if (!id) return;
  await pool.queryMaster(`DELETE FROM public.companies WHERE id::text = $1`, [id]);
}

/** Projeção comercial Master → SaaS (inclui bump de company_session_version no bloqueio). */
export async function applyCommercialProjectionToCompany(
  companyId: string,
  snapshot: CommercialProjectionSnapshot,
): Promise<{ rowCount: number }> {
  const id = String(companyId || '').trim();
  const result = await pool.queryMaster(
    `update public.companies
        set plan = $2,
            commercial_plan = $3,
            commercial_mode = $4,
            license_status = $5,
            license_expires_at = $6::timestamptz,
            subscription_status = $7,
            payment_status = $8,
            contracted_limits = $9::jsonb,
            commercial_blocked = $10,
            commercial_block_reason = $11,
            commercial_revision = $12,
            commercial_synced_at = now(),
            commercial_source = 'master',
            company_session_version = case
              when $10::boolean is true
               and commercial_blocked is distinct from true
              then coalesce(company_session_version, 0) + 1
              else company_session_version
            end,
            updated_at = now()
      where id::text = $1
      returning id`,
    [
      id,
      snapshot.plan,
      snapshot.commercialPlan,
      snapshot.commercialMode,
      snapshot.licenseStatus,
      snapshot.licenseExpiresAt,
      snapshot.subscriptionStatus,
      snapshot.paymentStatus,
      JSON.stringify(snapshot.contractedLimits),
      snapshot.commercialBlocked,
      snapshot.commercialBlockReason,
      snapshot.commercialRevision,
    ],
  );
  return { rowCount: result.rowCount ?? result.rows.length };
}

/** Incrementa company_session_version (revogação de sessões). */
export async function bumpOperationalCompanySessionVersion(
  companyId: string,
): Promise<number | null> {
  const id = String(companyId || '').trim();
  if (!id) return null;
  const result = await pool.queryMaster<{ company_session_version: string | number }>(
    `update public.companies
        set company_session_version = coalesce(company_session_version, 0) + 1,
            updated_at = now()
      where id::text = $1
      returning company_session_version`,
    [id],
  );
  const version = Number(result.rows[0]?.company_session_version ?? 0);
  return Number.isFinite(version) ? version : null;
}

/** First-access: convite gerado / senha provisória pendente. */
export async function markOperationalCompanyFirstAccessPending(
  companyId: string,
  emailAdmin: string,
): Promise<void> {
  const id = String(companyId || '').trim();
  if (!id) return;
  await pool.queryMaster(
    `UPDATE public.companies
        SET email_admin = $2,
            first_access_status = 'pending',
            updated_at = now()
      WHERE id::text = $1`,
    [id, emailAdmin],
  );
}

/** First-access: convite enviado. */
export async function markOperationalCompanyFirstAccessSent(
  companyId: string,
  emailAdmin: string,
): Promise<void> {
  const id = String(companyId || '').trim();
  if (!id) return;
  await pool.queryMaster(
    `UPDATE public.companies
        SET email_admin = $2,
            first_access_sent_at = coalesce(first_access_sent_at, now()),
            first_access_status = 'sent',
            updated_at = now()
      WHERE id::text = $1`,
    [id, emailAdmin],
  );
}

/** First-access: primeiro login aceito. */
export async function markOperationalCompanyFirstAccessAccepted(
  companyId: string,
): Promise<void> {
  const id = String(companyId || '').trim();
  if (!id) return;
  await pool.queryMaster(
    `update public.companies
        set first_access_status = 'accepted',
            updated_at = now()
      where id::text = $1`,
    [id],
  );
}

export const OperationalCompanyWriter = {
  upsertFromTenant: upsertOperationalCompanyFromTenant,
  deleteById: deleteOperationalCompany,
  applyCommercialProjection: applyCommercialProjectionToCompany,
  bumpSessionVersion: bumpOperationalCompanySessionVersion,
  markFirstAccessPending: markOperationalCompanyFirstAccessPending,
  markFirstAccessSent: markOperationalCompanyFirstAccessSent,
  markFirstAccessAccepted: markOperationalCompanyFirstAccessAccepted,
};
