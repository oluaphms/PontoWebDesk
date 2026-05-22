import { db, supabase } from '../../../services/supabaseClient';
import type { IDataProvider, ProviderLoginParams, ProviderPunchPayload } from '../dataProvider';
import { httpRequest } from '../httpClient';
import { assertNoSupabaseUsage } from '../supabaseGuard';

export const supabaseProvider: IDataProvider = {
  async login(params: ProviderLoginParams): Promise<any> {
    assertNoSupabaseUsage();
    const email = String(params.identifier || '').trim();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: params.password,
    });
    if (error) throw error;
    return data;
  },

  async getEmployees(companyId: string): Promise<Record<string, unknown>[]> {
    assertNoSupabaseUsage();
    if (!companyId) return [];
    const rows = await db.select(
      'users',
      [{ column: 'company_id', operator: 'eq', value: companyId }],
      { column: 'created_at', ascending: false },
    );
    return rows as Record<string, unknown>[];
  },

  async registerPunch(payload: ProviderPunchPayload): Promise<any> {
    assertNoSupabaseUsage();
    return db.insert('time_records', payload as Record<string, unknown>);
  },

  async registerPunchBatch(payload: { punches: ProviderPunchPayload[] }): Promise<any> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, degraded: true, retry_after: 60_000, results: [] };
    }
    const res = await httpRequest('/api/punches/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return res ?? { ok: false, degraded: true, results: [] };
  },

  async getAccessToken(): Promise<string | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  },
};

