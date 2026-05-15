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
import { getSupabaseUrlForServer } from './_shared/getSupabaseConfig.js';
import { z } from 'zod';
import { getSecureCorsHeaders, requireTrustedOrigin } from './_shared/security.js';

const FALLBACK_EMAIL_DOMAIN = 'pontowebdesk.local';

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

function normalizeEmail(email: string | undefined): string {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function generateSafeFallbackEmailBase(cpf: string, pis: string): string {
  const id = cpf || pis;
  const ts = Math.floor(Date.now() / 1000);
  return `${id}-${ts}`;
}

function generateFallbackPassword(): string {
  return `Pwd${Date.now().toString(36)}!${Math.random().toString(36).slice(2, 8)}`;
}

async function emailExistsInUsers(adminSup: any, email: string): Promise<boolean> {
  const { data, error } = await adminSup.from('users').select('id').eq('email', email).limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

function isValidDocument11Digits(doc: string): boolean {
  return /^\d{11}$/.test(doc);
}

async function getRoleFromUsers(adminSup: any, callerId: string): Promise<string | null> {
  const byId = await adminSup.from('users').select('role').eq('id', callerId).maybeSingle();
  const data = byId?.data ?? byId;
  if (data?.role) return String(data.role).toLowerCase();
  const byAuth = await adminSup.from('users').select('role').eq('auth_user_id', callerId).maybeSingle();
  const d = byAuth?.data ?? byAuth;
  return d?.role ? String(d.role).toLowerCase() : null;
}

const ConfirmEmailBodySchema = z.object({
  action: z.literal('confirm-email'),
  email: z.string().email(),
});

const SetPasswordBodySchema = z.object({
  action: z.literal('set-password'),
  email: z.string().email(),
  newPassword: z.string().min(6),
});

const CreateUserBodySchema = z.object({
  action: z.literal('create-user'),
  email: z.string().optional(),
  password: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const DeleteUserBodySchema = z.object({
  action: z.literal('delete-user'),
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
});

const AuthAdminBodySchema = z.discriminatedUnion('action', [
  ConfirmEmailBodySchema,
  SetPasswordBodySchema,
  CreateUserBodySchema,
  DeleteUserBodySchema,
]);

async function handleRequest(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const blockedOrigin = requireTrustedOrigin(request, corsHeaders);
  if (blockedOrigin) return blockedOrigin;

  const serviceKey = (typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? process.env.SUPABASE_SERVICE_ROLE_KEY : '').trim();
  const supabaseUrl = getSupabaseUrlForServer();
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

  let body: z.infer<typeof AuthAdminBodySchema>;
  try {
    const raw = await request.json();
    const parsed = AuthAdminBodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Body inválido.', code: 'BAD_REQUEST', details: parsed.error.flatten() },
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    body = parsed.data;
  } catch {
    return Response.json(
      { error: 'Body inválido.', code: 'BAD_REQUEST' },
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const action = body.action;
  const email = 'email' in body ? normalizeEmail(body.email) : '';

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

    if (action === 'delete-user') {
      const userIdRaw = 'userId' in body ? String(body.userId || '').trim() : '';
      const emailRaw = 'email' in body ? normalizeEmail(body.email) : '';
      let userIdToDelete = userIdRaw;
      if (!userIdToDelete && emailRaw) {
        const byEmail = users.find((u: any) => normalizeEmail(String(u.email || '')) === emailRaw);
        userIdToDelete = String(byEmail?.id || '').trim();
      }
      if (!userIdToDelete) {
        return Response.json(
          { success: false, error: 'Usuário não encontrado para rollback.', code: 'AUTH_ERROR' },
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { error: deleteErr } = await adminAuth.deleteUser(userIdToDelete);
      if (deleteErr) {
        console.error({ step: 'rollback_auth', success: false, user_id: userIdToDelete, error: deleteErr.message });
        return Response.json(
          { success: false, error: 'Falha ao remover usuário no Auth.', code: 'AUTH_ERROR' },
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.info({ step: 'rollback_auth', success: true, user_id: userIdToDelete });
      return Response.json(
        { success: true, userId: userIdToDelete },
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create-user') {
      const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
      const nome = String((metadata as Record<string, unknown>).nome ?? (metadata as Record<string, unknown>).name ?? '').trim();
      const cpf = normalizeDigits((metadata as Record<string, unknown>).cpf);
      const pis = normalizeDigits((metadata as Record<string, unknown>).pis ?? (metadata as Record<string, unknown>).pis_pasep);
      const companyId = String((metadata as Record<string, unknown>).company_id ?? '').trim() || null;

      const payloadLog = {
        action,
        emailProvided: !!email,
        nome,
        cpf: cpf ? `${cpf.slice(0, 3)}***` : '',
        pis: pis ? `${pis.slice(0, 3)}***` : '',
        companyId,
      };
      console.info('[auth-admin:create-user] payload recebido', payloadLog);

      if (!nome) {
        return Response.json(
          { success: false, user_id: null, error: 'Nome é obrigatório.', code: 'BAD_REQUEST' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!cpf && !pis) {
        return Response.json(
          { success: false, user_id: null, error: 'Informe CPF ou PIS/PASEP.', code: 'INVALID_DOCUMENT' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (cpf && !isValidDocument11Digits(cpf)) {
        return Response.json(
          { success: false, user_id: null, error: 'CPF deve conter 11 dígitos.', code: 'INVALID_DOCUMENT' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (pis && !isValidDocument11Digits(pis)) {
        return Response.json(
          { success: false, user_id: null, error: 'PIS/PASEP deve conter 11 dígitos.', code: 'INVALID_DOCUMENT' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (email && !isValidEmail(email)) {
        return Response.json(
          { success: false, user_id: null, error: 'E-mail inválido.', code: 'INVALID_EMAIL' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let emailToUse = email;
      if (!emailToUse) {
        const baseLocal = generateSafeFallbackEmailBase(cpf, pis);
        let candidate = `${baseLocal}@${FALLBACK_EMAIL_DOMAIN}`;
        let seq = 0;
        while (true) {
          const inAuth = users.some((u: any) => normalizeEmail(String(u.email || '')) === candidate);
          const inDb = await emailExistsInUsers(adminSup, candidate);
          if (!inAuth && !inDb) break;
          seq += 1;
          candidate = `${baseLocal}-${seq}@${FALLBACK_EMAIL_DOMAIN}`;
          if (seq > 20) {
            return Response.json(
              { success: false, user_id: null, error: 'Falha ao gerar e-mail único para cadastro.', code: 'AUTH_ERROR' },
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
        emailToUse = candidate;
      }
      const passwordRaw = typeof body.password === 'string' ? body.password.trim() : '';
      const generatedPassword = !passwordRaw;
      const passwordToUse = passwordRaw || generateFallbackPassword();
      if (passwordToUse.length < 6) {
        return Response.json(
          { success: false, user_id: null, error: 'Senha deve ter pelo menos 6 caracteres.', code: 'INVALID_PASSWORD' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const duplicateChecks = [
        emailToUse ? `email.eq.${emailToUse}` : '',
        cpf ? `cpf.eq.${cpf}` : '',
        pis ? `pis_pasep.eq.${pis}` : '',
      ].filter(Boolean);

      if (duplicateChecks.length > 0) {
        const { data: existingUsers, error: duplicateError } = await adminSup
          .from('users')
          .select('id,email,cpf,pis_pasep')
          .or(duplicateChecks.join(','))
          .limit(5);
        if (duplicateError) {
          console.error('[auth-admin:create-user] erro ao validar duplicidade', duplicateError);
          return Response.json(
            { success: false, user_id: null, error: 'Falha ao validar duplicidade de usuário.', code: 'DB_ERROR' },
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const found = existingUsers ?? [];
        if (found.some((u: { email?: string | null }) => normalizeEmail(u.email ?? '') === emailToUse)) {
          return Response.json(
            { success: false, user_id: null, error: 'E-mail já cadastrado.', code: 'USER_ALREADY_EXISTS' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (cpf && found.some((u: { cpf?: string | null }) => normalizeDigits(u.cpf) === cpf)) {
          return Response.json(
            { success: false, user_id: null, error: 'CPF já cadastrado.', code: 'CPF_ALREADY_EXISTS' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (pis && found.some((u: { pis_pasep?: string | null }) => normalizeDigits(u.pis_pasep) === pis)) {
          return Response.json(
            { success: false, user_id: null, error: 'PIS/PASEP já cadastrado.', code: 'PIS_ALREADY_EXISTS' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      try {
        console.info({ step: 'create_auth_user', email: emailToUse, company_id: companyId });
        const { data: created, error: createError } = await adminAuth.createUser({
          email: emailToUse,
          password: passwordToUse,
          email_confirm: true,
          user_metadata: {
            ...metadata,
            name: nome,
            nome,
            cpf: cpf || null,
            pis: pis || null,
            pis_pasep: pis || null,
            company_id: companyId,
            generated_password: generatedPassword,
          },
        });
        if (createError) {
          const { message: friendlyMessage } = mapAuthErrorToFriendly(createError.message || '', (createError as any).code || '', 400);
          console.error({ step: 'create_auth_user', success: false, error: createError.message });
          return Response.json(
            { success: false, user_id: null, error: friendlyMessage, code: 'AUTH_ERROR' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const userId = created?.user?.id ?? created?.id;
        if (!userId) {
          console.error({ step: 'create_auth_user', success: false, error: 'Sem user_id na resposta do Auth' });
          return Response.json(
            { success: false, user_id: null, error: 'Conta criada mas ID não retornado.', code: 'AUTH_ERROR' },
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.info({ step: 'create_auth_user', success: true, user_id: userId, used_fallback_email: !email, generated_password: generatedPassword });
        return Response.json(
          { success: true, user_id: userId, error: null },
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err: unknown) {
        console.error('[auth-admin:create-user] excecao', err);
        const errStr = messageFromUnknown(err, 'Falha ao criar usuário no Auth.');
        const mapped = mapAuthErrorToFriendly(errStr, '', 400);
        return Response.json(
          { success: false, user_id: null, error: mapped.message, code: 'AUTH_ERROR' },
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handleRequest(request);
    } catch (e: unknown) {
      const corsHeaders = getSecureCorsHeaders(request, {
        allowMethods: 'POST, OPTIONS',
        allowHeaders: 'Content-Type, Authorization',
      });
      return Response.json(
        { error: messageFromUnknown(e, 'Erro interno.'), code: 'INTERNAL_ERROR' },
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  },
};
