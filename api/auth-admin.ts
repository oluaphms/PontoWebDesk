/**
 * POST /api/auth-admin
 * Body: { action: 'confirm-email' | 'set-password' | 'create-user', email: string, ... }
 * Header: Authorization: Bearer <jwt do admin>
 *
 * Uma única Serverless Function que unifica:
 * - confirm-email: { action: 'confirm-email', email } → marca email_confirm=true
 * - set-password:  { action: 'set-password', email, newPassword } → altera senha no Auth
 * - create-user:   { action: 'create-user', email, password, metadata? } → cria usuário no Auth
 *
 * Reduz o número de funções no plano Hobby da Vercel (máx. 12).
 */

import { messageFromUnknown } from '../src/utils/messageFromUnknown';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

function mapAuthErrorToFriendly(rawMessage: string, rawCode: string, status: number): { message: string; code: string } {
  const lower = (rawMessage || '').toLowerCase();
  const codeLower = (rawCode || '').toLowerCase();
  if (status === 422 || /already registered|already exists|user already|duplicate|email.*taken|already_registered|user_already_exists/i.test(lower) || /already_registered|user_already_exists|duplicate/i.test(codeLower)) {
    return { message: 'E-mail já cadastrado.', code: 'USER_ALREADY_EXISTS' };
  }
  if (status === 403 || /forbidden|permission|access denied/i.test(lower) || /forbidden|access_denied/i.test(codeLower)) {
    return { message: 'Erro de permissão. Verifique se a chave de serviço tem permissão para criar usuários.', code: 'FORBIDDEN' };
  }
  if (status === 429 || /rate limit|too many requests|429/i.test(lower)) {
    return { message: 'Limite de requisições atingido. Aguarde alguns minutos e tente novamente.', code: 'RATE_LIMIT' };
  }
  if (/password|senha|invalid password|weak password|min.*character/i.test(lower) || /invalid_password|weak_password/i.test(codeLower)) {
    return { message: 'Senha inválida (mínimo 6 caracteres, conforme política do projeto).', code: 'INVALID_PASSWORD' };
  }
  if (/invalid email|email.*invalid|malformed/i.test(lower) || /invalid_email/i.test(codeLower)) {
    return { message: 'E-mail inválido.', code: 'INVALID_EMAIL' };
  }
  if (rawMessage && rawMessage.trim()) {
    return { message: rawMessage.trim(), code: rawCode && rawCode.trim() ? rawCode : 'CREATE_FAILED' };
  }
  return { message: 'Falha ao criar usuário no Auth.', code: 'CREATE_FAILED' };
}

async function getRoleFromUsers(adminSup: any, callerId: string): Promise<string | null> {
  const byId = await adminSup.from('users').select('role').eq('id', callerId).maybeSingle();
  const data = byId?.data ?? byId;
  if (data?.role) return String(data.role).toLowerCase();
  const byAuth = await adminSup.from('users').select('role').eq('auth_user_id', callerId).maybeSingle();
  const d = byAuth?.data ?? byAuth;
  return d?.role ? String(d.role).toLowerCase() : null;
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const serviceKey = (typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? process.env.SUPABASE_SERVICE_ROLE_KEY : '').trim();
  const supabaseUrl = (typeof process.env.SUPABASE_URL === 'string' ? process.env.SUPABASE_URL : (process.env.VITE_SUPABASE_URL as string) || '').toString().trim().replace(/\/$/, '');
  const anonKey = (typeof process.env.SUPABASE_ANON_KEY === 'string' ? process.env.SUPABASE_ANON_KEY : (process.env.VITE_SUPABASE_ANON_KEY as string) || '').trim();

  if (!serviceKey || !supabaseUrl) {
    return Response.json(
      { error: 'Configuração indisponível.', code: 'CONFIG_MISSING' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = (request.headers as any).get?.('Authorization') || (request.headers as any).get?.('authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return Response.json(
      { error: 'Token de autenticação obrigatório.', code: 'UNAUTHORIZED' },
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let body: { action?: string; email?: string; newPassword?: string; password?: string; metadata?: any } = {};
  try {
    const raw = await request.json();
    body = (raw && typeof raw === 'object' ? raw : {}) as typeof body;
  } catch {
    return Response.json(
      { error: 'Body inválido.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
  if (!['confirm-email', 'set-password', 'create-user'].includes(action)) {
    return Response.json(
      { error: 'action deve ser confirm-email, set-password ou create-user.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    return Response.json(
      { error: 'E-mail é obrigatório.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const adminSup = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let callerRole: string | null = null;
    if (anonKey) {
      const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
      });
      if (authRes.ok) {
        const authUser = await authRes.json();
        const callerId = authUser?.id;
        if (callerId) callerRole = await getRoleFromUsers(adminSup, callerId);
      }
    }
    if (callerRole !== 'admin' && callerRole !== 'hr') {
      return Response.json(
        { error: 'Apenas administrador ou RH pode executar esta ação.', code: 'FORBIDDEN' },
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminAuth = (adminSup.auth as any).admin;
    const { data: listData } = await adminAuth.listUsers({ perPage: 1000 });
    const users = listData?.users ?? [];
    const target = users.find((u: any) => String(u.email || '').toLowerCase() === email);

    if (action === 'confirm-email') {
      if (!target?.id) {
        return Response.json(
          { error: 'Usuário não encontrado no Auth com este e-mail.', code: 'USER_NOT_FOUND' },
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { error: updateErr } = await adminAuth.updateUserById(target.id, { email_confirm: true });
      if (updateErr) {
        return Response.json(
          { error: updateErr.message || 'Falha ao confirmar e-mail.', code: 'UPDATE_FAILED' },
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return Response.json(
        { success: true, message: 'E-mail confirmado. O funcionário já pode fazer login.' },
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'set-password') {
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (!newPassword || newPassword.length < 6) {
        return Response.json(
          { error: 'Senha deve ter no mínimo 6 caracteres.', code: 'BAD_REQUEST' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (!target?.id) {
        return Response.json(
          { error: 'Usuário não encontrado no Auth com este e-mail. Crie o acesso em Cadastrar Funcionário ou use a importação.', code: 'USER_NOT_FOUND' },
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { error: updateErr } = await adminAuth.updateUserById(target.id, { password: newPassword });
      if (updateErr) {
        return Response.json(
          { error: updateErr.message || 'Falha ao alterar senha.', code: 'UPDATE_FAILED' },
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return Response.json(
        { success: true, message: 'Senha alterada. O funcionário pode fazer login com o e-mail e a nova senha.' },
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create-user') {
      const password = typeof body.password === 'string' ? body.password : '';
      const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined;
      if (!password || password.trim().length < 6) {
        return Response.json(
          { error: 'Senha inválida (mínimo 6 caracteres).', code: 'BAD_REQUEST' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const authApiUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users`;
      const createRes = await fetch(authApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({
          email,
          password: password.trim(),
          email_confirm: true,
          ...(metadata && Object.keys(metadata).length > 0 ? { user_metadata: metadata } : {}),
        }),
      });
      const createBody = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        const rawMsg = createBody?.msg ?? createBody?.error_description ?? createBody?.message ?? createBody?.error;
        const errStr = typeof rawMsg === 'string' ? rawMsg : '';
        const code = createBody?.code ?? createBody?.error_code ?? '';
        const { message: friendlyMessage, code: friendlyCode } = mapAuthErrorToFriendly(errStr, code, createRes.status);
        const isAlreadyRegistered =
          createRes.status === 422 ||
          /already registered|already exists|user already|duplicate|email.*taken/i.test(errStr) ||
          /already_registered|user_already_exists|duplicate/i.test(String(code));
        if (isAlreadyRegistered && target?.id) {
          return Response.json(
            { success: true, userId: target.id, existing: true },
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return Response.json(
          { error: friendlyMessage, code: friendlyCode },
          { status: createRes.status >= 500 ? 500 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const userId = createBody?.id ?? createBody?.user?.id;
      if (!userId) {
        return Response.json(
          { error: 'Conta criada mas ID não retornado.', code: 'NO_ID' },
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return Response.json(
        { success: true, userId },
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return Response.json(
      { error: 'action inválido.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: unknown) {
    return Response.json(
      { error: messageFromUnknown(e, 'Erro interno.'), code: 'INTERNAL_ERROR' },
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export default async function handler(req: any, res: any) {
  try {
    const url = req.url?.startsWith('http') ? req.url : `https://${req.headers.host || 'localhost'}${req.url || ''}`;
    const init: RequestInit = { method: req.method, headers: req.headers as any };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (typeof req.body === 'string' || req.body instanceof Uint8Array) {
        (init as any).body = req.body;
      } else if (req.body) {
        (init as any).body = JSON.stringify(req.body);
      }
    }
    const request = new Request(url, init);
    const response = await handleRequest(request);
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    const text = await response.text();
    res.send(text);
  } catch (e: unknown) {
    res.status(500).setHeader('Content-Type', 'application/json').send(JSON.stringify({ error: messageFromUnknown(e, 'Erro interno.'), code: 'INTERNAL_ERROR' }));
  }
}
