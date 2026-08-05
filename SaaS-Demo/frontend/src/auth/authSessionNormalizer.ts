/**
 * Normaliza a resposta imediata de signInWithPassword — sem getSession/getUser extra.
 * Fonte única: response.data.session + response.data.user (GoTrue).
 */

export type SupabaseAuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

export type SupabaseSessionLike = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  user?: SupabaseAuthUserLike | null;
};

export type NormalizeOk = {
  ok: true;
  session: SupabaseSessionLike;
  authUser: SupabaseAuthUserLike;
  accessToken: string | null;
};

export type NormalizeFail = {
  ok: false;
  reason: 'missing_user' | 'missing_session' | 'user_session_mismatch';
  detail?: string;
};

/**
 * Valida e extrai sessão + utilizador Auth a partir do payload de signIn.
 */
export function normalizeAuthenticatedSession(data: {
  session: SupabaseSessionLike | null;
  user: SupabaseAuthUserLike | null;
}): NormalizeOk | NormalizeFail {
  const session = data.session;
  const user = data.user ?? session?.user ?? null;
  if (!user?.id) {
    return { ok: false, reason: 'missing_user' };
  }
  if (!session) {
    return { ok: false, reason: 'missing_session' };
  }
  const sessionUserId = session.user?.id;
  if (sessionUserId && sessionUserId !== user.id) {
    return {
      ok: false,
      reason: 'user_session_mismatch',
      detail: `${sessionUserId} vs ${user.id}`,
    };
  }
  const accessToken =
    typeof (session as { access_token?: string }).access_token === 'string'
      ? (session as { access_token: string }).access_token
      : null;
  return { ok: true, session, authUser: user, accessToken };
}
