/**
 * Serviço de histórico de ajustes de ponto
 * Responsável por consultar e exibir o histórico de mudanças
 */

import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { db } from '../../services/supabaseClient';

export interface AdjustmentHistoryEntry {
  id: string;
  adjustment_id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
  details: Record<string, any> | null;
  company_id: string | null;
  // Enriquecido no frontend
  changed_by_name?: string;
}

export const AdjustmentHistoryService = {
  /**
   * Obtém o histórico completo de um ajuste
   */
  async getAdjustmentHistory(adjustmentId: string): Promise<AdjustmentHistoryEntry[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('time_adjustments_history')
        .select('*')
        .eq('adjustment_id', adjustmentId)
        .order('changed_at', { ascending: true });

      if (error) {
        console.error('[AdjustmentHistory] Erro ao buscar histórico:', error.message);
        return [];
      }

      return (data ?? []) as AdjustmentHistoryEntry[];
    } catch (e) {
      console.error('[AdjustmentHistory] Erro:', e);
      return [];
    }
  },

  /**
   * Obtém histórico de todos os ajustes de uma empresa
   */
  async getCompanyAdjustmentHistory(
    companyId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<AdjustmentHistoryEntry[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('time_adjustments_history')
        .select('*')
        .eq('company_id', companyId)
        .order('changed_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('[AdjustmentHistory] Erro ao buscar histórico da empresa:', error.message);
        return [];
      }

      return (data ?? []) as AdjustmentHistoryEntry[];
    } catch (e) {
      console.error('[AdjustmentHistory] Erro:', e);
      return [];
    }
  },

  /**
   * Obtém histórico de um colaborador
   */
  async getUserAdjustmentHistory(
    userId: string,
    limit: number = 50
  ): Promise<AdjustmentHistoryEntry[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('time_adjustments_history')
        .select(`
          *,
          adjustment_id (
            user_id
          )
        `)
        .eq('adjustment_id.user_id', userId)
        .order('changed_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[AdjustmentHistory] Erro ao buscar histórico do usuário:', error.message);
        return [];
      }

      return (data ?? []) as AdjustmentHistoryEntry[];
    } catch (e) {
      console.error('[AdjustmentHistory] Erro:', e);
      return [];
    }
  },

  /**
   * Formata entrada de histórico para exibição
   */
  formatHistoryEntry(entry: AdjustmentHistoryEntry): string {
    const date = new Date(entry.changed_at).toLocaleString('pt-BR');
    const status = `${entry.old_status ?? 'novo'} → ${entry.new_status}`;
    const reason = entry.reason ? ` (${entry.reason})` : '';
    return `${date}: ${status}${reason}`;
  },

  /**
   * Obtém resumo de mudanças (quantas aprovações, rejeições, etc)
   */
  async getAdjustmentStats(companyId: string): Promise<{
    total_changes: number;
    approvals: number;
    rejections: number;
    pending_to_approved: number;
    pending_to_rejected: number;
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return {
        total_changes: 0,
        approvals: 0,
        rejections: 0,
        pending_to_approved: 0,
        pending_to_rejected: 0,
      };
    }

    try {
      const { data, error } = await supabase
        .from('time_adjustments_history')
        .select('*')
        .eq('company_id', companyId);

      if (error) {
        console.error('[AdjustmentHistory] Erro ao calcular stats:', error.message);
        return {
          total_changes: 0,
          approvals: 0,
          rejections: 0,
          pending_to_approved: 0,
          pending_to_rejected: 0,
        };
      }

      const entries = (data ?? []) as AdjustmentHistoryEntry[];
      const stats = {
        total_changes: entries.length,
        approvals: entries.filter(e => e.new_status === 'approved').length,
        rejections: entries.filter(e => e.new_status === 'rejected').length,
        pending_to_approved: entries.filter(e => e.old_status === 'pending' && e.new_status === 'approved').length,
        pending_to_rejected: entries.filter(e => e.old_status === 'pending' && e.new_status === 'rejected').length,
      };

      return stats;
    } catch (e) {
      console.error('[AdjustmentHistory] Erro:', e);
      return {
        total_changes: 0,
        approvals: 0,
        rejections: 0,
        pending_to_approved: 0,
        pending_to_rejected: 0,
      };
    }
  },
};
