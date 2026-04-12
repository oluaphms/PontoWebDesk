/**
 * Serviço de convite e criação de funcionários.
 * - Convite por link: createEmployeeInviteByLink() insere em employee_invites e retorna link.
 * - Convite por e-mail (API): inviteEmployeeByEmail() chama VITE_INVITE_API_URL.
 */

import { getAppBaseUrl } from '../../services/appUrl';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';

const INVITE_API_URL = import.meta.env.VITE_INVITE_API_URL as string | undefined;

function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface CreateInviteByLinkPayload {
  email: string;
  role?: string;
  companyId: string;
  createdById: string;
  expiresInDays?: number;
}

export interface CreateInviteByLinkResult {
  success: boolean;
  inviteLink?: string;
  error?: string;
}

/** Cria convite por link (tabela employee_invites). O aceite é feito na página /accept-invite e nas APIs /api/employee-invite e /api/accept-employee-invite. */
export async function createEmployeeInviteByLink(payload: CreateInviteByLinkPayload): Promise<CreateInviteByLinkResult> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não configurado.' };
  }
  const emailNorm = payload.email.trim().toLowerCase();
  if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    return { success: false, error: 'E-mail válido é obrigatório.' };
  }
  const role = (payload.role || 'employee').trim() || 'employee';
  const expiresInDays = Math.min(30, Math.max(1, payload.expiresInDays ?? 7));
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const token = generateInviteToken();
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    await db.insert('employee_invites', {
      id,
      email: emailNorm,
      role,
      token,
      expires_at: expiresAt.toISOString(),
      created_by: payload.createdById,
      company_id: payload.companyId,
    });
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return { success: false, error: 'Já existe um convite pendente para este e-mail.' };
    }
    return { success: false, error: err?.message ?? 'Erro ao criar convite.' };
  }

  const origin = getAppBaseUrl();
  if (!origin || !/^https?:\/\//.test(origin)) {
    return { success: false, error: 'URL do app não configurada (VITE_APP_URL ou origin).' };
  }
  const inviteLink = `${origin}/accept-invite?token=${encodeURIComponent(token)}`;
  return { success: true, inviteLink };
}

export interface InvitePayload {
  email: string;
  nome?: string;
  department_id?: string;
  role?: string;
  schedule_id?: string;
  redirectUrl?: string;
}

export interface InviteResult {
  success: boolean;
  error?: string;
}

export async function inviteEmployeeByEmail(payload: InvitePayload): Promise<InviteResult> {
  if (!INVITE_API_URL?.trim()) {
    return {
      success: false,
      error: 'Convites não configurados. Defina VITE_INVITE_API_URL (Edge Function ou API que use Supabase Admin inviteUserByEmail).',
    };
  }
  try {
    const res = await fetch(INVITE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: payload.email.trim().toLowerCase(),
        nome: payload.nome?.trim(),
        department_id: payload.department_id || undefined,
        role: payload.role || 'employee',
        schedule_id: payload.schedule_id || undefined,
        redirect_url: payload.redirectUrl || getAppBaseUrl(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: (data as { error?: string }).error || res.statusText || 'Erro ao enviar convite.' };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Erro de rede ao enviar convite.' };
  }
}

export interface CsvEmployeeRow {
  name: string;
  email: string;
  department: string;
  role: string;
}

const CSV_HEADER = ['name', 'email', 'department', 'role'];

/**
 * Parse CSV string (estrutura: name,email,department,role).
 * Suporta linhas com aspas e vírgulas dentro de campos.
 */
export function parseEmployeesCsv(csvText: string): CsvEmployeeRow[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase().replace(/\s/g, '').split(',').map((h) => h.replace(/^"|"$/g, ''));
  const nameIdx = header.indexOf('name') >= 0 ? header.indexOf('name') : 0;
  const emailIdx = header.indexOf('email') >= 0 ? header.indexOf('email') : 1;
  const deptIdx = header.indexOf('department') >= 0 ? header.indexOf('department') : 2;
  const roleIdx = header.indexOf('role') >= 0 ? header.indexOf('role') : 3;
  const rows: CsvEmployeeRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.match(/("([^"]*)"|[^,]*)/g)?.map((p) => p.replace(/^"|"$/g, '').trim()) ?? line.split(',');
    const name = (parts[nameIdx] ?? '').trim();
    const email = (parts[emailIdx] ?? '').trim().toLowerCase();
    if (!email) continue;
    rows.push({
      name: name || email.split('@')[0],
      email,
      department: (parts[deptIdx] ?? '').trim(),
      role: (parts[roleIdx] ?? 'employee').trim() || 'employee',
    });
  }
  return rows;
}
