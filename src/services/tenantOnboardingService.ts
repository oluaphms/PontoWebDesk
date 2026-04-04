import { supabase, isSupabaseConfigured } from '../../services/supabase';

export type CreateTenantResult = { tenantId: string; ok: boolean };

/**
 * Cria tenant (empresa), vínculo do usuário atual e configurações padrão de jornada (RPC no Supabase).
 * Exige migration `20260403200000_multi_tenant_tenant_id_rls_audit.sql`.
 */
export async function createTenantOnboarding(params: {
  nome: string;
  slug: string;
  plan?: 'free' | 'pro' | 'enterprise';
}): Promise<{ data: CreateTenantResult | null; error: Error | null }> {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Supabase não configurado') };
  }
  const { data, error } = await supabase.rpc('create_tenant_onboarding', {
    p_nome: params.nome.trim(),
    p_slug: params.slug.trim().toLowerCase().replace(/\s+/g, '-'),
    p_plan: params.plan ?? 'free',
  });
  if (error) return { data: null, error: error as Error };
  const raw = data as { tenant_id?: string; ok?: boolean } | null;
  if (!raw?.tenant_id) return { data: null, error: new Error('Resposta inválida do servidor') };
  return { data: { tenantId: raw.tenant_id, ok: !!raw.ok }, error: null };
}
