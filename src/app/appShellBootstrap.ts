import type { User } from '../../types';

/**
 * Identidade mínima pós-auth — sem I/O pesado, sem permissões derivadas, sem GEO/dashboard.
 */
export interface MinimalAuthenticatedUser {
  id: string;
  company_id: string;
  role: string;
  full_name: string;
}

export interface MinimalSessionShell {
  user: MinimalAuthenticatedUser;
  access_token: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
}

export const SMARTPONTO_PROFILE_ENRICHED_EVENT = 'smartponto_profile_enriched';

function resolveRoleFromAuthUser(authUser: {
  email?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}): User['role'] {
  const email = (authUser?.email || '').trim().toLowerCase();
  let role: User['role'] = 'employee';
  const metaRoleRaw =
    authUser.app_metadata?.role ??
    authUser.user_metadata?.role ??
    (Array.isArray(authUser.app_metadata?.roles) ? (authUser.app_metadata.roles as unknown[])[0] : undefined);
  if (typeof metaRoleRaw === 'string') {
    const r = metaRoleRaw.toLowerCase();
    if (r === 'admin' || r === 'hr' || r === 'supervisor' || r === 'employee') {
      role = r as User['role'];
    }
  }
  if (email === 'admin@smartponto.com' || email === 'desenvolvedor@smartponto.com') {
    role = 'admin';
  }
  if (email === 'funcionario@smartponto.com') {
    role = 'employee';
  }
  return role;
}

/**
 * Monta shell só com JWT/metadata — alinhado ao `User` do app para navegação imediata.
 */
export function createMinimalSessionShell(
  authUser: {
    id: string;
    email?: string | null;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  },
  session: { access_token?: string; refresh_token?: string; expires_at?: number } | null | undefined,
): { shell: MinimalSessionShell; appUser: User } {
  const email = (authUser?.email || '').trim().toLowerCase();
  const role = resolveRoleFromAuthUser(authUser);
  const meta = authUser.user_metadata as { tenant_id?: string; company_id?: string; nome?: string } | undefined;
  const cid = String(meta?.tenant_id || meta?.company_id || '');
  const full_name = meta?.nome || (email ? email.split('@')[0] : 'Usuário');

  const minimal: MinimalAuthenticatedUser = {
    id: authUser.id,
    company_id: cid,
    role: String(role),
    full_name,
  };

  const appUser: User = {
    id: authUser.id,
    nome: full_name,
    email: authUser.email || '',
    cargo: 'Colaborador',
    role,
    createdAt: new Date(),
    companyId: cid,
    tenantId: cid,
    departmentId: '',
    avatar: meta && typeof meta === 'object' && 'avatar_url' in meta ? (meta as { avatar_url?: string }).avatar_url : undefined,
    preferences: {
      notifications: true,
      theme: 'light',
      allowManualPunch: true,
      language: 'pt-BR',
    },
  };

  return {
    shell: {
      user: minimal,
      access_token: session?.access_token ?? null,
      refresh_token: session?.refresh_token ?? null,
      expires_at: session?.expires_at ?? null,
    },
    appUser,
  };
}

export function dispatchProfileEnriched(appUser: User): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(SMARTPONTO_PROFILE_ENRICHED_EVENT, { detail: appUser }));
  } catch {
    // ignora
  }
}
