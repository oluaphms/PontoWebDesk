/**
 * Endpoint consolidado de convites:
 * - GET  /api/employee-invite?token=xxx
 * - POST /api/employee-invite/accept  (via rewrite legada /api/accept-employee-invite)
 */

import type { PostgrestError } from '@supabase/supabase-js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP } from './_shared/security.js';
import { assertPlanLimit, isPlanLimitError, PLAN_LIMIT_CODE } from '../services/planEnforcement';
import { resolveRequestUrl } from './_shared/getRequestBaseUrl.js';
import { getSupabaseUrlForServer } from './_shared/getSupabaseConfig.js';

/** API Admin do GoTrue (service role). Tipagem local — o cliente tipado do browser não expõe `admin`. */
type GoTrueAdminApi = {
  createUser: (params: {
    email: string;
    password: string;
    email_confirm?: boolean;
  }) => Promise<{ data: { user?: { id: string }; id?: string } | null; error: { message: string } | null }>;
  listUsers: (params: { perPage: number }) => Promise<{
    data: { users?: Array<{ id: string; email?: string }> } | null;
    error: unknown;
  }>;
  updateUserById: (id: string, attrs: { password: string }) => Promise<{ error: unknown }>;
};

function getGoTrueAdmin(auth: unknown): GoTrueAdminApi {
  return (auth as { admin: GoTrueAdminApi }).admin;
}

const ALLOWED_METHODS = 'GET, POST, OPTIONS';

type InviteRow = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  used_at: string | null;
  company_id: string | null;
};

export default async function handler(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: ALLOWED_METHODS,
    allowHeaders: 'Content-Type, Authorization',
  });

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Rate limiting por IP (mais restritivo para convites)
  const clientIP = getClientIP(request);
  const rateLimit = checkRateLimit(clientIP, 'login');
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Muitas tentativas. Aguarde alguns minutos.', code: 'RATE_LIMITED', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const pathname = resolveRequestUrl(request).pathname;
  const isAccept = /\/api\/employee-invite\/accept\/?$/.test(pathname);

  if (!isAccept && request.method !== 'GET') {
    return Response.json(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (isAccept && request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const serviceKey = (typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? process.env.SUPABASE_SERVICE_ROLE_KEY : '').trim();
  const supabaseUrl = getSupabaseUrlForServer();

  if (!serviceKey || !supabaseUrl) {
    return Response.json(
      { error: 'Configuração indisponível.', code: 'CONFIG_MISSING' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const adminSup = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (!isAccept) {
      const url = resolveRequestUrl(request);
      const token = url.searchParams.get('token')?.trim();
      if (!token) {
        return Response.json(
          { error: 'Token obrigatório', code: 'BAD_REQUEST' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data, error } = await adminSup
        .from('employee_invites')
        .select('email, role, expires_at, used_at')
        .eq('token', token)
        .maybeSingle();

      if (error) {
        console.error('[employee-invite]', error);
        return Response.json(
          { error: 'Erro ao consultar convite', code: 'DB_ERROR' },
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (!data) {
        return Response.json(
          { error: 'Link inválido ou expirado', code: 'INVALID_TOKEN' },
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (data.used_at) {
        return Response.json(
          { error: 'Este convite já foi utilizado', code: 'ALREADY_USED' },
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
      if (Date.now() > expiresAt) {
        return Response.json(
          { error: 'Este link expirou', code: 'EXPIRED' },
          { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return Response.json(
        { email: data.email, role: data.role, expiresAt: data.expires_at },
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let body: { token?: string; name?: string; password?: string } = {};
    try {
      const raw = await request.json();
      body = (raw && typeof raw === 'object' ? raw : {}) as typeof body;
    } catch {
      return Response.json(
        { error: 'Body inválido', code: 'BAD_REQUEST' },
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const password = typeof body.password === 'string' ? body.password.trim() : '';
    if (!token) return Response.json({ error: 'Token é obrigatório', code: 'BAD_REQUEST' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!name || name.length < 2) return Response.json({ error: 'Nome completo é obrigatório', code: 'BAD_REQUEST' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!password || password.length < 6) return Response.json({ error: 'Senha deve ter no mínimo 6 caracteres', code: 'BAD_REQUEST' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: invite, error: inviteError } = await adminSup
      .from('employee_invites')
      .select('id, email, role, expires_at, used_at, company_id')
      .eq('token', token)
      .maybeSingle();
    const row = invite as InviteRow | null;
    if (inviteError || !row) return Response.json({ error: 'Link inválido ou expirado', code: 'INVALID_TOKEN' }, { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (row.used_at) return Response.json({ error: 'Este convite já foi utilizado', code: 'ALREADY_USED' }, { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (Date.now() > (row.expires_at ? new Date(row.expires_at).getTime() : 0)) return Response.json({ error: 'Este link expirou', code: 'EXPIRED' }, { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const email = String(row.email).trim().toLowerCase();
    const role = row.role || 'employee';
    const companyId = row.company_id || '';
    let authUserId: string | null = null;
    const authAdmin = getGoTrueAdmin(adminSup.auth);
    const { data: authData, error: authError } = await authAdmin.createUser({ email, password, email_confirm: true });
    if (authError) {
      const msg = String(authError.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered')) {
        const { data: list } = await authAdmin.listUsers({ perPage: 1000 });
        const existing = list?.users?.find((u) => String(u.email || '').toLowerCase() === email);
        if (!existing?.id) return Response.json({ error: 'Este e-mail já possui cadastro. Use "Esqueci minha senha" na tela de login.', code: 'EMAIL_EXISTS' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const { error: updateErr } = await authAdmin.updateUserById(existing.id, { password });
        if (updateErr) return Response.json({ error: 'Este e-mail já possui cadastro. Use "Esqueci minha senha" na tela de login.', code: 'EMAIL_EXISTS' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        authUserId = existing.id;
      } else {
        return Response.json({ error: authError.message || 'Erro ao criar conta', code: 'AUTH_ERROR' }, { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      authUserId = authData?.user?.id ?? authData?.id ?? null;
    }
    if (!authUserId) return Response.json({ error: 'Erro ao criar usuário', code: 'AUTH_ERROR' }, { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if (companyId && (role === 'employee' || !row.role)) {
      try {
        await assertPlanLimit(adminSup, { tenantId: companyId, action: { type: 'CREATE_EMPLOYEE' } });
      } catch (e) {
        if (isPlanLimitError(e)) {
          return Response.json(
            { code: PLAN_LIMIT_CODE, message: e.message, error: e.message },
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw e;
      }
    }

    const { error: userInsertError } = await adminSup.from('users').insert({
      id: authUserId, nome: name, email, cargo: 'Colaborador', role, company_id: companyId, department_id: '', avatar: null,
      preferences: { notifications: true, theme: 'light', allowManualPunch: true, language: 'pt-BR' }, created_at: new Date().toISOString(),
    });
    if (userInsertError) {
      const code = String((userInsertError as PostgrestError)?.code || '');
      const msg = String((userInsertError as PostgrestError)?.message || '').toLowerCase();
      if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
        const patch: Record<string, unknown> = { nome: name, role, preferences: { notifications: true, theme: 'light', allowManualPunch: true, language: 'pt-BR' }, updated_at: new Date().toISOString() };
        if (companyId && String(companyId).trim() !== '') patch.company_id = companyId;
        await adminSup.from('users').update(patch).eq('id', authUserId);
      } else {
        return Response.json({ error: userInsertError.message || 'Erro ao criar perfil', code: 'DB_ERROR' }, { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    await adminSup.from('employee_invites').update({ used_at: new Date().toISOString() }).eq('id', row.id);
    return Response.json({ success: true, message: 'Conta criada. Faça login com seu e-mail e senha.' }, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[employee-invite]', msg);
    return Response.json(
      { error: 'Erro interno', code: 'INTERNAL_ERROR' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
