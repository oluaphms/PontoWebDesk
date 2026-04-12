/**
 * Serviço de fluxo de Ajuste de Ponto
 *
 * Responsável por:
 * - Aprovar: localizar o time_record original, aplicar o horário corrigido, registrar auditoria
 * - Rejeitar: salvar motivo, registrar auditoria
 * - Notificar o colaborador em ambos os casos
 */

import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { db } from '../../services/supabaseClient';
import { NotificationService } from '../../services/notificationService';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';

export interface AdjustmentRequest {
  id: string;
  user_id: string;
  time_record_id: string | null;
  date: string | null;
  original_time: string | null;
  requested_time: string;
  adjustment_type: 'entrada' | 'saida' | 'ambos';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  company_id: string;
  // enriquecido no frontend
  user_nome?: string;
}

interface ApproveParams {
  request: AdjustmentRequest;
  adminId: string;
  adminName: string;
  companyId: string;
}

interface RejectParams {
  request: AdjustmentRequest;
  adminId: string;
  adminName: string;
  companyId: string;
  rejectionReason: string;
}

/**
 * Constrói o novo `created_at` do time_record mantendo a data original
 * e substituindo apenas o horário pelo solicitado (HH:MM).
 */
function buildNewTimestamp(originalCreatedAt: string | null, requestedTime: string, fallbackDate: string | null): string {
  const base = originalCreatedAt ?? fallbackDate ?? new Date().toISOString();
  const datePart = base.slice(0, 10); // YYYY-MM-DD
  return `${datePart}T${requestedTime}:00.000Z`;
}

export const AdjustmentFlowService = {
  /**
   * Aprova um ajuste:
   * 1. Atualiza time_adjustments.status → 'approved'
   * 2. Se houver time_record_id, atualiza o created_at do registro original
   * 3. Registra auditoria com valor antigo vs novo
   * 4. Notifica o colaborador
   */
  async approve({ request, adminId, adminName, companyId }: ApproveParams): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase não configurado.');

    const now = new Date().toISOString();

    // 1) Buscar o time_record original para capturar o valor antigo
    let originalCreatedAt: string | null = null;
    if (request.time_record_id) {
      try {
        const rows = await db.select(
          'time_records',
          [{ column: 'id', operator: 'eq', value: request.time_record_id }],
          undefined,
          1,
        ) as any[];
        originalCreatedAt = rows?.[0]?.created_at ?? null;
      } catch {
        // segue sem o valor antigo — não bloqueia a aprovação
      }
    }

    const newTimestamp = buildNewTimestamp(originalCreatedAt, request.requested_time, request.date);

    // 2) Atualizar time_adjustments
    const { error: adjError } = await supabase
      .from('time_adjustments')
      .update({
        status: 'approved',
        reviewed_by: adminId,
        reviewed_at: now,
        original_time: originalCreatedAt ?? request.original_time ?? null,
        updated_at: now,
      })
      .eq('id', request.id);

    if (adjError) throw new Error(adjError.message);

    // 3) Aplicar o ajuste no time_record original (se existir)
    if (request.time_record_id && originalCreatedAt) {
      const { error: recError } = await supabase
        .from('time_records')
        .update({ created_at: newTimestamp, updated_at: now })
        .eq('id', request.time_record_id);

      if (recError) {
        // Logar mas não reverter — o ajuste já foi aprovado; admin pode corrigir manualmente
        console.error('[AdjustmentFlow] Falha ao atualizar time_record:', recError.message);
      }
    }

    // 4) Auditoria
    await LoggingService.log({
      severity: LogSeverity.SECURITY,
      action: 'ADMIN_APPROVE_ADJUSTMENT',
      userId: adminId,
      userName: adminName,
      companyId,
      details: {
        adjustmentId: request.id,
        employeeId: request.user_id,
        timeRecordId: request.time_record_id,
        oldValue: originalCreatedAt,
        newValue: newTimestamp,
        requestedTime: request.requested_time,
        adjustmentType: request.adjustment_type,
      },
    });

    // 4b) Registrar no histórico (trigger automático também registra)
    try {
      await supabase
        .from('time_adjustments_history')
        .insert({
          adjustment_id: request.id,
          old_status: 'pending',
          new_status: 'approved',
          changed_by: adminId,
          company_id: companyId,
          reason: `Aprovado por ${adminName}`,
          details: {
            timeRecordId: request.time_record_id,
            oldTimestamp: originalCreatedAt,
            newTimestamp: newTimestamp,
            requestedTime: request.requested_time,
          },
        });
    } catch (histError) {
      console.warn('[AdjustmentFlow] Falha ao registrar histórico:', histError);
    }

    // 5) Resolver notificações pendentes e criar nova
    await NotificationService.resolveByReference(request.user_id, request.id, 'adjustment');
    await NotificationService.create({
      userId: request.user_id,
      type: 'success',
      title: 'Ajuste de ponto aprovado',
      message: `Seu ajuste para ${request.requested_time} em ${request.date ?? 'data solicitada'} foi aprovado.`,
      actionUrl: '/employee/timesheet',
      metadata: { adjustmentId: request.id },
    });
  },

  /**
   * Rejeita um ajuste:
   * 1. Atualiza time_adjustments.status → 'rejected'
   * 2. Registra auditoria
   * 3. Notifica o colaborador
   */
  async reject({ request, adminId, adminName, companyId, rejectionReason }: RejectParams): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase não configurado.');

    const now = new Date().toISOString();

    const { error } = await supabase
      .from('time_adjustments')
      .update({
        status: 'rejected',
        reviewed_by: adminId,
        reviewed_at: now,
        rejection_reason: rejectionReason || null,
        updated_at: now,
      })
      .eq('id', request.id);

    if (error) throw new Error(error.message);

    await LoggingService.log({
      severity: LogSeverity.WARN,
      action: 'ADMIN_REJECT_ADJUSTMENT',
      userId: adminId,
      userName: adminName,
      companyId,
      details: {
        adjustmentId: request.id,
        employeeId: request.user_id,
        rejectionReason,
      },
    });

    // Registrar no histórico (trigger automático também registra)
    try {
      await supabase
        .from('time_adjustments_history')
        .insert({
          adjustment_id: request.id,
          old_status: 'pending',
          new_status: 'rejected',
          changed_by: adminId,
          company_id: companyId,
          reason: rejectionReason || `Rejeitado por ${adminName}`,
          details: {
            rejectionReason: rejectionReason,
          },
        });
    } catch (histError) {
      console.warn('[AdjustmentFlow] Falha ao registrar histórico:', histError);
    }

    await NotificationService.resolveByReference(request.user_id, request.id, 'adjustment');
    await NotificationService.create({
      userId: request.user_id,
      type: 'warning',
      title: 'Ajuste de ponto rejeitado',
      message: rejectionReason
        ? `Seu ajuste foi rejeitado: ${rejectionReason}`
        : 'Seu ajuste de ponto foi rejeitado pelo administrador.',
      metadata: { adjustmentId: request.id },
    });
  },
};
