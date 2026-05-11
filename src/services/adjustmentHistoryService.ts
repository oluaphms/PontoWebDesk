/**
 * Serviço de histórico de ajustes de ponto
 * Responsável por consultar e exibir o histórico de mudanças
 */

import { supabase, checkSupabaseConfigured } from '../../services/supabase';
import { db } from '../../services/supabaseClient';

export interface AdjustmentHistoryEntry {
  id: string;
  adjustment_id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
  details: Record<string, unknown> | null;
  company_id: string | null;
  // Enriquecido no frontend
  changed_by_name?: string;
}

function normalizeScopedCompanyIds(entries: AdjustmentHistoryEntry[]): string[] {
  return Array.from(
    new Set(
      entries
        .map((entry) => String(entry.company_id ?? '').trim())
        .filter((companyId) => companyId.length > 0),
    ),
  );
}

async function loadScopedUsersById(userIds: string[], companyIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0 || companyIds.length === 0) {
    return new Map<string, string>();
  }

  try {
    const users = (await db.select(
      'users',
      [
        { column: 'id', operator: 'in', value: userIds },
        { column: 'company_id', operator: 'in', value: companyIds },
      ],
      { columns: 'id, nome', limit: Math.max(1, userIds.length * 2) },
    )) as Array<{ id: string; nome?: string | null }>;
    return new Map((users || []).map((u) => [u.id, u.nome || u.id]));
  } catch (error) {
    console.error('[AdjustmentHistoryService] Error loading scoped users:', error);
    return new Map<string, string>();
  }
}

export const AdjustmentHistoryService = {
  /**
   * Obtém o histórico completo de um ajuste
   */
  async getAdjustmentHistory(adjustmentId: string): Promise<AdjustmentHistoryEntry[]> {
    if (!checkSupabaseConfigured()) return [];

    try {
      const { data, error } = await supabase
        .from('time_adjustments_history')
        .select('*')
        .eq('adjustment_id', adjustmentId)
        .order('changed_at', { ascending: true });

      if (error) {
        console.error('[AdjustmentHistoryService] Error fetching history:', error);
        return [];
      }

      const entries: AdjustmentHistoryEntry[] = data || [];

      // Enriquecer com nomes de usuários
      const userIds = [...new Set(entries.map((e) => e.changed_by).filter(Boolean))] as string[];
      const companyIds = normalizeScopedCompanyIds(entries);
      if (userIds.length > 0 && companyIds.length > 0) {
        const userMap = await loadScopedUsersById(userIds, companyIds);
        entries.forEach((e) => {
          if (e.changed_by) {
            e.changed_by_name = userMap.get(e.changed_by) || e.changed_by;
          }
        });
      }

      return entries;
    } catch (err) {
      console.error('[AdjustmentHistoryService] Unexpected error:', err);
      return [];
    }
  },

  /**
   * Obtém o histórico de múltiplos ajustes de uma vez
   */
  async getHistoryForAdjustments(adjustmentIds: string[]): Promise<AdjustmentHistoryEntry[]> {
    if (!checkSupabaseConfigured()) return [];

    try {
      const { data, error } = await supabase
        .from('time_adjustments_history')
        .select('*')
        .in('adjustment_id', adjustmentIds)
        .order('changed_at', { ascending: true });

      if (error) {
        console.error('[AdjustmentHistoryService] Error fetching batch history:', error);
        return [];
      }

      const entries: AdjustmentHistoryEntry[] = data || [];

      // Enriquecer com nomes de usuários
      const userIds = [...new Set(entries.map((e) => e.changed_by).filter(Boolean))] as string[];
      const companyIds = normalizeScopedCompanyIds(entries);
      if (userIds.length > 0 && companyIds.length > 0) {
        const userMap = await loadScopedUsersById(userIds, companyIds);
        entries.forEach((e) => {
          if (e.changed_by) {
            e.changed_by_name = userMap.get(e.changed_by) || e.changed_by;
          }
        });
      }

      return entries;
    } catch (err) {
      console.error('[AdjustmentHistoryService] Unexpected batch error:', err);
      return [];
    }
  },

  /**
   * Registra uma nova entrada no histórico
   */
  async recordHistory(
    adjustmentId: string,
    oldStatus: string | null,
    newStatus: string,
    reason: string | null,
    details: Record<string, unknown> | null,
    companyId: string | null
  ): Promise<void> {
    if (!checkSupabaseConfigured()) {
      console.warn('[AdjustmentHistoryService] Supabase not configured, skipping history record');
      return;
    }

    try {
      const { error } = await supabase.from('time_adjustments_history').insert({
        adjustment_id: adjustmentId,
        old_status: oldStatus,
        new_status: newStatus,
        reason,
        details,
        company_id: companyId,
        changed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        changed_at: new Date().toISOString(),
      });

      if (error) {
        console.error('[AdjustmentHistoryService] Error recording history:', error);
      }
    } catch (err) {
      console.error('[AdjustmentHistoryService] Unexpected error recording history:', err);
    }
  },
};
