import { SYSTEM_CONFIG } from '../config/system';

export type CreateTenantResult = { tenantId: string; ok: boolean };

/**
 * @deprecated FASE 6.6+ — criação de empresas é exclusiva do Painel Master.
 * Mantido apenas para compatibilidade de imports; sempre retorna erro.
 */
export async function createTenantOnboarding(_params: {
  nome: string;
  slug: string;
  plan?: 'free' | 'pro' | 'enterprise';
}): Promise<{ data: CreateTenantResult | null; error: Error | null }> {
  void _params;
  void SYSTEM_CONFIG;
  return {
    data: null,
    error: new Error(
      'COMPANY_CREATE_MASTER_ONLY: criação de empresas é exclusiva do Painel Master (/master/tenants/new).',
    ),
  };
}
