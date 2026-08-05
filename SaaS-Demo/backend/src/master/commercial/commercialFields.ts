/**
 * Campos comerciais — única fonte de verdade: Painel Master.
 * O SaaS operacional só lê a projeção; nunca escreve estes campos.
 */

export const COMMERCIAL_COMPANY_FIELDS = [
  'plan',
  'commercial_plan',
  'commercial_mode',
  'license_status',
  'license_expires_at',
  'subscription_status',
  'payment_status',
  'contracted_limits',
  'commercial_blocked',
  'commercial_block_reason',
  'commercial_revision',
  'commercial_synced_at',
  'commercial_source',
  'company_session_version',
] as const;

export type CommercialCompanyField = (typeof COMMERCIAL_COMPANY_FIELDS)[number];

const COMMERCIAL_FIELD_SET = new Set<string>(COMMERCIAL_COMPANY_FIELDS);

export function isCommercialCompanyField(field: string): boolean {
  return COMMERCIAL_FIELD_SET.has(field);
}

/** Retorna campos comerciais presentes no payload (chaves normalizadas). */
export function findCommercialFieldsInPayload(
  payload: Record<string, unknown>,
): CommercialCompanyField[] {
  const found: CommercialCompanyField[] = [];
  for (const key of Object.keys(payload)) {
    const normalized = key.trim();
    if (isCommercialCompanyField(normalized)) {
      found.push(normalized as CommercialCompanyField);
    }
  }
  return found;
}

export const COMMERCIAL_FIELDS_MASTER_ONLY_CODE = 'COMMERCIAL_FIELDS_MASTER_ONLY' as const;

export const COMMERCIAL_FIELDS_MASTER_ONLY_MESSAGE =
  'Campos comerciais são gerenciados exclusivamente pelo Painel Master.';
