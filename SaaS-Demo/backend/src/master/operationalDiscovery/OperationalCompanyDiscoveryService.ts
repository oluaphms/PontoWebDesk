/**
 * Descoberta automática de empresas operacionais pelo Painel Master (Fase 6.6).
 *
 * - Fonte de verdade: public.companies
 * - Domínio comercial: master_tenants + assinatura/licença/CRM/financeiro/notificações
 * - NUNCA cria uma segunda linha em companies
 */
import { randomUUID } from 'node:crypto';
import { checkDatabaseConnection, pool } from '../../db/index.js';
import { logger } from '../../logger/logger.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { projectCommercialStateToSaas } from '../commercial/index.js';
import { CommercialCrmService } from '../crm/CommercialCrmService.js';
import { SubscriptionFinanceService } from '../subscriptionFinance/SubscriptionFinanceService.js';
import { SubscriptionNotificationService } from '../subscriptionNotifications/SubscriptionNotificationService.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';
import type {
  InitializeCommercialResult,
  OperationalCompanyDirectoryRow,
  OrphanCommercialReport,
} from './operationalDiscovery.types.js';
import { buildCommercialLicenseViewState } from '../license/licenseValidity.js';

export class OperationalDiscoveryError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'OperationalDiscoveryError';
    this.status = status;
    this.code = code;
  }
}

type CompanyRow = {
  id: string;
  nome: string | null;
  name: string | null;
  cnpj: string | null;
  telefone: string | null;
  phone: string | null;
  responsavel_nome: string | null;
  responsavel_email: string | null;
};

export type OperationalCompanyMatch = {
  id: string;
  cnpj: string | null;
  nome: string | null;
  name: string | null;
};

type LinkedTenantRow = {
  id: string;
  operational_company_id: string | null;
  company_name: string;
  plan: string | null;
  status: string;
  license_expires_at: Date | string | null;
};

type DirectoryQueryRow = {
  operational_company_id: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  master_tenant_id: string | null;
  plan: string | null;
  status: string | null;
  expires_at: Date | string | null;
  commercial_situation: string | null;
  first_access_status: string | null;
  first_access_sent_at: Date | string | null;
  first_access_last_error: string | null;
  first_login_at?: Date | string | null;
  origin: 'operational' | 'orphan';
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function companyDisplayName(row: Pick<CompanyRow, 'nome' | 'name'>): string {
  return String(row.nome || row.name || '').trim() || 'Empresa operacional';
}

function normalizeDocumentDigits(value: string | null | undefined): string {
  return String(value || '').replace(/\D+/g, '').trim();
}

function slugDomain(companyId: string, name: string): string {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const idPart = companyId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || randomUUID().slice(0, 8);
  return `${base || 'empresa'}-${idPart}.operational.local`;
}

function isDomainAlreadyInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /domain already in use/i.test(message);
}

type DirectoryRowBeforeValidity = Omit<OperationalCompanyDirectoryRow, 'licenseValidity'>;

function mapDirectoryRow(row: DirectoryQueryRow): DirectoryRowBeforeValidity {
  const initialized = Boolean(row.master_tenant_id) && row.origin === 'operational';
  const orphan = row.origin === 'orphan';
  return {
    operationalCompanyId: row.operational_company_id,
    razaoSocial: String(row.razao_social || '').trim() || '—',
    nomeFantasia: row.nome_fantasia ? String(row.nome_fantasia).trim() : null,
    cnpj: row.cnpj ? String(row.cnpj).trim() : null,
    email: row.email ? String(row.email).trim() : null,
    telefone: row.telefone ? String(row.telefone).trim() : null,
    masterTenantId: row.master_tenant_id,
    plan: row.plan,
    status: row.status,
    expiresAt: iso(row.expires_at),
    commercialSituation: orphan
      ? 'orphan_commercial'
      : initialized
        ? row.commercial_situation || row.status || 'initialized'
        : 'not_initialized',
    firstAccessStatus:
      row.first_login_at || String(row.first_access_status || '') === 'accepted'
        ? 'accepted'
        : row.first_access_status
          ? (String(row.first_access_status) as 'pending' | 'sent' | 'failed' | 'accepted')
          : null,
    firstAccessSentAt: iso(row.first_access_sent_at),
    firstAccessLastError:
      row.first_login_at || String(row.first_access_status || '') === 'accepted'
        ? null
        : row.first_access_last_error
          ? String(row.first_access_last_error)
          : null,
    origin: row.origin,
    commercialInitialized: initialized,
    initStatus: orphan
      ? 'orphan_commercial'
      : initialized
        ? 'initialized'
        : 'not_initialized',
  };
}

async function loadOperationalCompany(companyId: string): Promise<CompanyRow> {
  const result = await pool.queryMaster<CompanyRow>(
    `SELECT id::text AS id,
            nome, name, cnpj, telefone, phone,
            responsavel_nome, responsavel_email
       FROM public.companies
      WHERE id::text = $1
      LIMIT 1`,
    [companyId],
  );
  if (!result.rows[0]) {
    throw new OperationalDiscoveryError(
      404,
      'OPERATIONAL_COMPANY_NOT_FOUND',
      `Empresa operacional não encontrada: ${companyId}`,
    );
  }
  return result.rows[0];
}

async function findTenantByOperationalCompanyId(
  companyId: string,
): Promise<LinkedTenantRow | null> {
  const result = await pool.queryMaster<LinkedTenantRow>(
    `SELECT id, operational_company_id::text AS operational_company_id,
            company_name, plan, status, license_expires_at
       FROM public.master_tenants
      WHERE operational_company_id::text = $1
      LIMIT 1`,
    [companyId],
  );
  return result.rows[0] ?? null;
}

async function resolveAdminForCompany(
  company: CompanyRow,
): Promise<{ name: string; email: string; userId: string | null }> {
  const fromCompanyEmail = String(company.responsavel_email || '')
    .trim()
    .toLowerCase();
  const fromCompanyName = String(company.responsavel_nome || '').trim();

  const users = await pool.queryMaster<{ id: string; email: string; nome: string | null }>(
    `SELECT id::text AS id, lower(trim(email)) AS email, nome
       FROM public.users
      WHERE company_id::text = $1
        AND lower(coalesce(role, '')) IN ('admin', 'owner', 'rh')
        AND email IS NOT NULL AND trim(email) <> ''
      ORDER BY CASE lower(coalesce(role, ''))
                 WHEN 'owner' THEN 0
                 WHEN 'admin' THEN 1
                 ELSE 2
               END
      LIMIT 1`,
    [company.id],
  );
  const user = users.rows[0];
  if (user?.email) {
    return {
      name: String(user.nome || fromCompanyName || 'Administrador').trim() || 'Administrador',
      email: user.email,
      userId: user.id,
    };
  }
  if (fromCompanyEmail && fromCompanyEmail.includes('@')) {
    return {
      name: fromCompanyName || 'Administrador',
      email: fromCompanyEmail,
      userId: null,
    };
  }
  // Placeholder estável — não cria usuário operacional; só preenche o registro comercial.
  const safeId = company.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'empresa';
  return {
    name: fromCompanyName || companyDisplayName(company),
    email: `admin+${safeId}@operational.local`,
    userId: null,
  };
}

async function ensureNotificationPreferences(
  tenantId: string,
  companyId: string,
): Promise<boolean> {
  try {
    const notifications = new SubscriptionNotificationService();
    await notifications.updatePreferences(
      tenantId,
      {
        receiveEmail: true,
        notifyDueIn7: true,
        notifyDueIn3: true,
        notifyDueToday: true,
        notifyAfterBlock: true,
      },
      null,
    );
    // company_id na preferência deve apontar para o operacional
    await pool.queryMaster(
      `UPDATE public.master_subscription_notification_preferences
          SET company_id = $2, updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId, companyId],
    );
    return true;
  } catch {
    return false;
  }
}

async function ensureInitialFinanceEntry(
  companyId: string,
  actorUserId: string | null,
): Promise<string | null> {
  try {
    const finance = new SubscriptionFinanceService();
    const existing = await finance.listCompanyTimeline(companyId).catch(() => []);
    if (existing.length > 0) return existing[0].id;
    const entry = await finance.createPayment({
      companyId,
      status: 'PENDING',
      description: 'Ciclo comercial inicial (descoberta operacional)',
      actorUserId,
    });
    return entry.id;
  } catch {
    // Assinatura sem valor / ciclo ainda não pronto — domínio financeiro fica disponível via UI.
    return null;
  }
}

export const OperationalCompanyDiscoveryService = {
  async findOperationalCompanyByDocument(
    document: string | null | undefined,
  ): Promise<OperationalCompanyMatch | null> {
    const normalized = normalizeDocumentDigits(document);
    if (!normalized) return null;
    const result = await pool.queryMaster<OperationalCompanyMatch>(
      `SELECT id::text AS id,
              coalesce(
                nullif(trim(c.cnpj), ''),
                nullif(trim(to_jsonb(c)->>'cpf_cnpj'), '')
              ) AS cnpj,
              c.nome,
              c.name
         FROM public.companies c
        WHERE regexp_replace(
                coalesce(
                  nullif(trim(c.cnpj), ''),
                  nullif(trim(to_jsonb(c)->>'cpf_cnpj'), '')
                ),
                '\D',
                '',
                'g'
              ) = $1
        ORDER BY created_at ASC NULLS LAST, id
        LIMIT 1`,
      [normalized],
    );
    return result.rows[0] ?? null;
  },

  /** Lista companies + vínculo comercial (+ órfãos comerciais). */
  async listDirectory(input?: { q?: string }): Promise<{
    ok: true;
    companies: OperationalCompanyDirectoryRow[];
    orphans: OrphanCommercialReport[];
    count: number;
    uninitializedCount: number;
  }> {
    const dbOk = await checkDatabaseConnection();
    if (!dbOk) {
      throw new OperationalDiscoveryError(
        503,
        'OPERATIONAL_DATABASE_UNAVAILABLE',
        'Banco operacional indisponível para consulta de empresas.',
      );
    }
    const q = String(input?.q || '').trim().toLowerCase();

    const result = await pool.queryMaster<DirectoryQueryRow>(
      `WITH operational AS (
         SELECT c.id::text AS operational_company_id,
                coalesce(nullif(trim(c.nome), ''), nullif(trim(c.name), ''), 'Empresa') AS razao_social,
                nullif(trim(c.name), '') AS nome_fantasia,
                nullif(trim(c.cnpj), '') AS cnpj,
                coalesce(
                  nullif(trim(c.responsavel_email), ''),
                  (
                    SELECT nullif(trim(u.email), '')
                      FROM public.users u
                     WHERE u.company_id::text = c.id::text
                     ORDER BY CASE lower(coalesce(u.role, ''))
                                WHEN 'owner' THEN 0
                                WHEN 'admin' THEN 1
                                ELSE 2
                              END
                     LIMIT 1
                  )
                ) AS email,
                coalesce(nullif(trim(c.telefone), ''), nullif(trim(c.phone), '')) AS telefone,
                t.id AS master_tenant_id,
                t.plan,
                t.status,
                t.license_expires_at AS expires_at,
                crm.situation AS commercial_situation,
                onb.first_access_status,
                onb.first_access_sent_at,
                onb.first_access_last_error,
                onb.first_login_at,
                'operational'::text AS origin
           FROM public.companies c
           LEFT JOIN public.master_tenants t
             ON t.operational_company_id::text = c.id::text
           LEFT JOIN public.master_crm_profiles crm
             ON crm.master_tenant_id = t.id
           LEFT JOIN public.master_commercial_onboardings onb
             ON onb.master_tenant_id = t.id
       ),
       orphans AS (
         SELECT t.operational_company_id::text AS operational_company_id,
                t.company_name AS razao_social,
                null::text AS nome_fantasia,
                null::text AS cnpj,
                t.admin_email AS email,
                null::text AS telefone,
                t.id AS master_tenant_id,
                t.plan,
                t.status,
                t.license_expires_at AS expires_at,
                crm.situation AS commercial_situation,
                onb.first_access_status,
                onb.first_access_sent_at,
                onb.first_access_last_error,
                onb.first_login_at,
                'orphan'::text AS origin
           FROM public.master_tenants t
           LEFT JOIN public.companies c
             ON c.id::text = t.operational_company_id::text
           LEFT JOIN public.master_crm_profiles crm
             ON crm.master_tenant_id = t.id
           LEFT JOIN public.master_commercial_onboardings onb
             ON onb.master_tenant_id = t.id
          WHERE t.operational_company_id IS NOT NULL
            AND c.id IS NULL
       )
       SELECT * FROM operational
       UNION ALL
       SELECT * FROM orphans
       ORDER BY razao_social ASC NULLS LAST`,
    );

    let companies = result.rows.map(mapDirectoryRow);
    if (q) {
      companies = companies.filter((row) => {
        const hay = [
          row.razaoSocial,
          row.nomeFantasia || '',
          row.cnpj || '',
          row.email || '',
          row.masterTenantId || '',
          row.operationalCompanyId || '',
          row.plan || '',
          row.status || '',
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const orphans: OrphanCommercialReport[] = companies
      .filter((row) => row.initStatus === 'orphan_commercial' && row.masterTenantId && row.operationalCompanyId)
      .map((row) => ({
        masterTenantId: row.masterTenantId!,
        operationalCompanyId: row.operationalCompanyId!,
        companyName: row.razaoSocial,
        status: String(row.status || ''),
        reason: 'operational_company_missing' as const,
      }));

    // Vigência comercial: única fonte = buildCommercialLicenseViewState.
    let licensesByTenant = new Map<
      string,
      { startsAt: string; expiresAt: string | null; status: string; validity?: import('../license/licenseValidity.js').CommercialLicenseViewState }
    >();
    try {
      const licenses = await MasterPlatformService.getLicenseManager().list();
      licensesByTenant = new Map(
        licenses.map((l) => [
          l.tenantId,
          {
            startsAt: l.startsAt,
            expiresAt: l.expiresAt,
            status: l.status,
            validity: l.validity,
          },
        ]),
      );
    } catch {
      licensesByTenant = new Map();
    }

    const companiesWithValidity: OperationalCompanyDirectoryRow[] = companies.map((row) => {
      const lic = row.masterTenantId ? licensesByTenant.get(row.masterTenantId) : undefined;
      // Contrato: licenseValidity sempre objeto (fonte única no backend).
      const licenseValidity =
        lic?.validity ??
        buildCommercialLicenseViewState({
          startsAt: lic?.startsAt ?? null,
          expiresAt: lic?.expiresAt ?? row.expiresAt ?? null,
          tenantStatus: row.status,
          licenseStatus: lic?.status ?? null,
        });
      return { ...row, licenseValidity };
    });

    return {
      ok: true,
      companies: companiesWithValidity,
      orphans,
      count: companiesWithValidity.length,
      uninitializedCount: companiesWithValidity.filter((c) => c.initStatus === 'not_initialized').length,
    };
  },

  async listOrphans(): Promise<OrphanCommercialReport[]> {
    const directory = await this.listDirectory();
    return directory.orphans;
  },

  /**
   * Cria SOMENTE domínio comercial para uma company operacional existente.
   * Idempotente: se já houver master_tenants vinculado, reutiliza e completa lacunas.
   */
  async initializeCommercial(
    operationalCompanyIdRaw: string,
    actor?: { userId?: string | null; email?: string | null },
  ): Promise<InitializeCommercialResult> {
    const dbOk = await checkDatabaseConnection();
    if (!dbOk) {
      throw new OperationalDiscoveryError(
        503,
        'OPERATIONAL_DATABASE_UNAVAILABLE',
        'Banco operacional indisponível para inicialização comercial.',
      );
    }
    const operationalCompanyId = String(operationalCompanyIdRaw || '').trim();
    if (!operationalCompanyId) {
      throw new OperationalDiscoveryError(400, 'COMPANY_ID_REQUIRED', 'operationalCompanyId é obrigatório.');
    }

    const company = await loadOperationalCompany(operationalCompanyId);
    const existingLink = await findTenantByOperationalCompanyId(operationalCompanyId);
    const tenants = MasterPlatformService.getTenantsService();
    let reused = false;
    let tenant: ManagedTenant;

    if (existingLink) {
      reused = true;
      tenant = await tenants.get(existingLink.id);
      if (!tenant.operationalCompanyId) {
        tenant = await tenants.update(tenant.id, { operationalCompanyId });
      }
    } else {
      const admin = await resolveAdminForCompany(company);
      const name = companyDisplayName(company);
      const baseDomain = slugDomain(operationalCompanyId, name);
      const createInput = {
        operationalCompanyId,
        company: {
          name,
          document: company.cnpj,
          tradeName: company.name || company.nome || null,
        },
        admin: {
          name: admin.name,
          email: admin.email,
          userId: admin.userId,
        },
        plan: 'TRIAL' as const,
        status: 'trial' as const,
        mode: 'SAAS' as const,
        installationType: 'SAAS_WEB' as const,
        meta: {
          source: 'operational_discovery',
          linkedOperationalCompanyId: operationalCompanyId,
        },
      };
      try {
        tenant = await tenants.create({
          ...createInput,
          domain: baseDomain,
        });
      } catch (error) {
        if (!isDomainAlreadyInUseError(error)) throw error;
        try {
          // Idempotência: se o domínio já existir, reaproveita o tenant compatível.
          const byDomain = await tenants.getManager().getByDomain(baseDomain);
          if (!byDomain.operationalCompanyId || byDomain.operationalCompanyId === operationalCompanyId) {
            reused = true;
            tenant =
              byDomain.operationalCompanyId === operationalCompanyId
                ? byDomain
                : await tenants.update(byDomain.id, { operationalCompanyId });
          } else {
            const fallbackDomain = `${baseDomain.replace(/\.operational\.local$/, '')}-${randomUUID().slice(0, 6)}.operational.local`;
            tenant = await tenants.create({
              ...createInput,
              domain: fallbackDomain,
            });
          }
        } catch (fallbackError) {
          throw fallbackError;
        }
      }
    }

    // Onboarding com o ID operacional existente (não gera UUID novo).
    const onboardingIdempotencyKey = `discover:${operationalCompanyId}:${tenant.id}`;
    await pool.queryMaster(
      `INSERT INTO public.master_commercial_onboardings (
         id, idempotency_key, master_tenant_id, operational_company_id,
         customer_id, admin_email, state
       ) VALUES ($1,$2,$3,$4,$5,$6,'pending')
       ON CONFLICT (operational_company_id) DO UPDATE SET
         idempotency_key = EXCLUDED.idempotency_key,
         master_tenant_id = EXCLUDED.master_tenant_id,
         admin_email = EXCLUDED.admin_email,
         operational_company_id = EXCLUDED.operational_company_id,
         updated_at = now()`,
      [
        `onb_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        onboardingIdempotencyKey,
        tenant.id,
        operationalCompanyId,
        `cust_${tenant.id}`,
        tenant.admin.email,
      ],
    );

    // NÃO chama INSERT em companies — apenas vincula e completa domínio comercial.
    const lifecycle = MasterPlatformService.getLifecycle();
    let subscription = await lifecycle.findCurrentByTenant(tenant.id);
    if (!subscription) {
      subscription = await lifecycle.createSubscription({
        tenantId: tenant.id,
        customerId: `cust_${tenant.id}`,
        plan: 'TRIAL',
        meta: { source: 'operational_discovery', operationalCompanyId },
      });
    }
    await pool.queryMaster(
      `UPDATE public.master_commercial_onboardings
          SET subscription_id = $2,
              completed_steps = coalesce(completed_steps, '[]'::jsonb) || '["company","plan"]'::jsonb,
              updated_at = now()
        WHERE master_tenant_id = $1`,
      [tenant.id, subscription.id],
    );

    // company_id da assinatura aponta para o operacional.
    await pool.queryMaster(
      `UPDATE public.master_subscriptions
          SET company_id = $2, updated_at = now()
        WHERE id = $1`,
      [subscription.id, operationalCompanyId],
    ).catch(() => undefined);

    const licenseManager = MasterPlatformService.getLicenseManager();
    let license = await licenseManager.getByTenantId(tenant.id);
    if (!license) {
      const { isLicenseIntentionallyDeleted } = await import(
        '../license/licenseDeletionGuard.js'
      );
      const deletedOnPurpose = await isLicenseIntentionallyDeleted(tenant.id);
      if (deletedOnPurpose) {
        logger.info({
          module: 'master.operationalDiscovery',
          action: 'LICENSE_RECREATE_SKIPPED',
          message: 'Licença não recriada — exclusão intencional no Master',
          companyId: operationalCompanyId,
          meta: { tenantId: tenant.id, result: 'skipped' },
        });
      } else {
        license = await licenseManager.create({
          tenantId: tenant.id,
          empresa: tenant.company.name,
          mode: tenant.mode,
          status: 'Trial',
          plan: 'TRIAL',
          durationDays: 14,
        });
      }
    }
    if (license) {
      await pool.queryMaster(
        `UPDATE public.master_commercial_onboardings
            SET license_id = $2,
                completed_steps = coalesce(completed_steps, '[]'::jsonb) || '["license"]'::jsonb,
                state = 'completed',
                updated_at = now()
          WHERE master_tenant_id = $1`,
        [tenant.id, license.id],
      );
    }

    if (tenant.status === 'draft') {
      tenant = await tenants.applyAction(tenant.id, 'start_trial', {
        reason: 'operational_discovery',
      });
    }

    await projectCommercialStateToSaas({
      tenant,
      license,
      subscription: subscription.toProps(),
    });

    await CommercialCrmService.getSnapshot(tenant.id);
    const crmInitialized = true;

    const notificationsInitialized = await ensureNotificationPreferences(
      tenant.id,
      operationalCompanyId,
    );
    const financeEntryId = await ensureInitialFinanceEntry(
      operationalCompanyId,
      actor?.userId ?? null,
    );

    return {
      ok: true,
      reused,
      operationalCompanyId,
      masterTenantId: tenant.id,
      subscriptionId: subscription.id,
      licenseId: license?.id ?? null,
      crmInitialized,
      financeEntryId,
      notificationsInitialized,
      message: reused
        ? 'Domínio comercial já existia — lacunas completadas sem duplicar empresa.'
        : 'Domínio comercial inicializado a partir da empresa operacional (sem criar nova company).',
    };
  },
};
