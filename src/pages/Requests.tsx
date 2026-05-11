import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ClipboardList, PlusCircle, Trash2 } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, LoadingState } from '../../components/UI';
import { formatRequestType, formatWorkflowStatus } from '../../lib/i18n';
import { useLanguage } from '../contexts/LanguageContext';
import { db, isSupabaseConfigured, supabase, getSupabaseClient, type Filter } from '../services/supabaseClient';
import { NotificationService } from '../../services/notificationService';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';
import { useToast } from '../components/ToastProvider';
import { ExpandableTextCell } from '../components/ClickableFullContent';
import { invalidateAfterPunch, invalidatePendingRequestsCachesForUsers } from '../services/queryCache';
import { mapPunchTypeToDb, TIPOS_BATIDA } from '../constants/punchTypes';
import { localDateAndTimeToIsoUtc } from '../utils/localDateTimeToIso';
import { registerApprovedAdjustmentPunch } from '../services/requestApproval.service';

interface RequestRow {
  id: string;
  type: string;
  status: string;
  reason: string;
  created_at: string;
  user_id: string;
  company_id?: string;
  /** Ajuste de ponto: data/hora/tipo da batida solicitada */
  metadata?: Record<string, unknown> | null;
}

function getAdjustmentMeta(row: RequestRow): {
  date: string;
  time: string;
  punchType: string;
} | null {
  if (row.type !== 'adjustment' || !row.metadata || typeof row.metadata !== 'object') return null;
  const m = row.metadata as Record<string, unknown>;
  const date = typeof m.adjustment_date === 'string' ? m.adjustment_date.trim() : '';
  const time = typeof m.adjustment_time === 'string' ? m.adjustment_time.trim() : '';
  const punchType = typeof m.punch_type === 'string' ? m.punch_type.trim() : 'ENTRADA';
  if (!date || !time) return null;
  return { date, time, punchType };
}

const RequestsPage: React.FC = () => {
  useLanguage();
  const { user, loading } = useCurrentUser();
  const toast = useToast();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<{
    type: string;
    reason: string;
    adjustment_date: string;
    adjustment_time: string;
    punch_type: string;
  }>({
    type: 'adjustment',
    reason: '',
    adjustment_date: new Date().toISOString().slice(0, 10),
    adjustment_time: '09:00',
    punch_type: 'ENTRADA',
  });

  const isAdminView =
    user?.role === 'admin' || user?.role === 'hr' || user?.role === 'supervisor';

  useEffect(() => {
    if (!user || !isSupabaseConfigured()) return;

    const load = async () => {
      setIsLoadingData(true);
      try {
        const filters: Filter[] = [];
        if (!isAdminView) {
          filters.push({ column: 'user_id', operator: 'eq', value: user.id });
        }
        // Otimização: carregar apenas colunas necessárias com limite
        const res =
          (await db.select(
            'requests',
            filters,
            {
              columns: 'id, type, status, reason, created_at, user_id, company_id, metadata',
              orderBy: { column: 'created_at', ascending: false },
              limit: 200,
            },
          )) ?? [];

        setRows(
          res.map((r: any) => ({
            id: r.id,
            type: r.type,
            status: typeof r.status === 'string' ? r.status.trim().toLowerCase() : String(r.status ?? ''),
            reason: r.reason,
            created_at: r.created_at,
            user_id: r.user_id,
            company_id: r.company_id,
            metadata: r.metadata ?? null,
          })),
        );
      } catch (e) {
        console.error('Erro ao carregar solicitações:', e);
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user, isAdminView]);

  const openCreate = () => {
    setForm({
      type: 'adjustment',
      reason: '',
      adjustment_date: new Date().toISOString().slice(0, 10),
      adjustment_time: '09:00',
      punch_type: 'ENTRADA',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const reason = form.reason.trim();
    if (!user || !isSupabaseConfigured()) {
      toast.addToast('error', 'Sistema indisponível. Tente novamente.');
      return;
    }
    if (!reason || reason.length < 3) {
      toast.addToast('error', 'Informe o motivo (mínimo 3 caracteres).');
      return;
    }
    if (form.type === 'adjustment') {
      if (!form.adjustment_date || !form.adjustment_time) {
        toast.addToast('error', 'Informe a data e o horário da batida solicitada.');
        return;
      }
    }
    if (!user.companyId) {
      toast.addToast('error', 'Seu cadastro está sem empresa. Contate o RH.');
      return;
    }

    setSubmitting(true);
    try {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const payload: Record<string, unknown> = {
        id,
        user_id: user.id,
        company_id: user.companyId,
        type: form.type,
        status: 'pending',
        reason,
        created_at: createdAt,
      };
      if (form.type === 'adjustment') {
        payload.metadata = {
          adjustment_date: form.adjustment_date,
          adjustment_time: form.adjustment_time,
          punch_type: form.punch_type,
        };
      }

      await db.insert('requests', payload);

      setRows((prev) => [
        {
          id,
          user_id: user.id,
          type: form.type,
          status: 'pending',
          reason,
          created_at: createdAt,
          company_id: user.companyId,
          metadata:
            form.type === 'adjustment'
              ? (payload.metadata as RequestRow['metadata'])
              : null,
        },
        ...prev,
      ]);

      toast.addToast('success', 'Solicitação enviada com sucesso.');
      invalidatePendingRequestsCachesForUsers([user.id]);

      try {
        // Notificar o colaborador
        await NotificationService.create({
          userId: user.id,
          type: 'info',
          title: 'Solicitação enviada',
          message: 'Sua solicitação foi registrada e aguarda aprovação.',
          metadata: { requestId: id },
        });
      } catch {
        /* notificação opcional */
      }

      try {
        // Notificar todos os admins/RH da empresa
        const admins = await db.select('users', [
          { column: 'company_id', operator: 'eq', value: user.companyId },
          { column: 'role', operator: 'in', value: ['admin', 'hr'] },
        ]);

        for (const admin of admins || []) {
          try {
            await NotificationService.create({
              userId: String(admin.id ?? ''),
              type: 'info',
              title: 'Nova solicitação',
              message: `${user.nome} enviou uma nova solicitação de ${form.type === 'adjustment' ? 'ajuste de ponto' : form.type === 'vacation' ? 'férias' : 'mudança de turno'}.`,
              metadata: { requestId: id },
              actionUrl: '/requests',
            });
          } catch (e) {
            console.error('Erro ao notificar admin:', e);
          }
        }
      } catch (e) {
        console.error('Erro ao buscar admins:', e);
      }

      try {
        await LoggingService.log({
          severity: LogSeverity.INFO,
          action: 'USER_CREATE_REQUEST',
          userId: user.id,
          userName: user.nome,
          companyId: user.companyId,
          details: { type: form.type },
        });
      } catch {
        /* log opcional */
      }

      setForm({
        type: 'adjustment',
        reason: '',
        adjustment_date: new Date().toISOString().slice(0, 10),
        adjustment_time: '09:00',
        punch_type: 'ENTRADA',
      });
      setIsModalOpen(false);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : 'Falha ao enviar solicitação.';
      console.error('Erro ao criar solicitação:', err);
      toast.addToast('error', msg.includes('row-level') ? 'Permissão negada ao salvar. Verifique com o administrador.' : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (row: RequestRow, status: 'approved' | 'rejected') => {
    if (!user || !isSupabaseConfigured()) return;

    const companyId = row.company_id ?? user.companyId;
    if (!companyId) {
      toast.addToast('error', 'Empresa não identificada para esta solicitação.');
      return;
    }

    if (status === 'approved' && row.type === 'adjustment') {
      const adj = getAdjustmentMeta(row);
      if (adj) {
        if (!getSupabaseClient()) {
          toast.addToast('error', 'Cliente indisponível. Tente novamente.');
          return;
        }
        try {
          const iso = localDateAndTimeToIsoUtc(adj.date, adj.time);
          const dbType = mapPunchTypeToDb(adj.punchType);
          await registerApprovedAdjustmentPunch(supabase, {
            userId: row.user_id,
            companyId,
            dbType,
            timestampIso: iso,
            requestId: row.id,
            reason: row.reason,
          });
          invalidateAfterPunch(row.user_id, companyId);
        } catch (e: unknown) {
          console.error('Erro ao inserir batida da solicitação:', e);
          const msg =
            e && typeof e === 'object' && 'message' in e
              ? String((e as { message?: string }).message)
              : 'Falha ao registrar a batida.';
          toast.addToast('error', msg);
          return;
        }
      } else {
        toast.addToast(
          'info',
          'Esta solicitação não possui data/hora da batida nos dados. Registre a batida no Espelho de Ponto ou peça um novo pedido com os dados completos.',
        );
      }
    }

    try {
      await db.update('requests', row.id, { status });

      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status } : r)),
      );

      invalidatePendingRequestsCachesForUsers([user.id, row.user_id]);

      // Deletar notificação da solicitação para o admin/RH
      try {
        // Buscar todas as notificações do admin sobre esta solicitação
        const allNotifications = await NotificationService.getAll(user.id, true);
        const requestNotifications = allNotifications.filter(
          (n) => n.metadata?.requestId === row.id
        );
        
        // Deletar cada notificação
        for (const notif of requestNotifications) {
          await NotificationService.markAsRead(user.id, notif.id);
        }
      } catch (e) {
        console.error('Erro ao deletar notificação do admin:', e);
      }

      // Resolve notificações pendentes do colaborador referentes a esta solicitação
      await NotificationService.resolveByReference(row.user_id, row.id, 'request');

      // Cria nova notificação informando o resultado
      const approvedAdjustment = status === 'approved' && row.type === 'adjustment';
      const hadMeta = !!getAdjustmentMeta(row);
      await NotificationService.create({
        userId: row.user_id,
        type: status === 'approved' ? 'success' : 'warning',
        title: 'Solicitação atualizada',
        message:
          status === 'approved'
            ? approvedAdjustment && hadMeta
              ? 'Sua solicitação de ajuste foi aprovada e a batida foi registrada no espelho de ponto.'
              : approvedAdjustment
                ? 'Sua solicitação de ajuste foi aprovada. O RH pode registrar a batida no espelho de ponto se ainda não constar.'
                : 'Sua solicitação foi aprovada.'
            : 'Sua solicitação foi rejeitada.',
        metadata: { requestId: row.id },
      });

      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'ADMIN_UPDATE_REQUEST',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { requestId: row.id, status },
      });
    } catch (err) {
      console.error('Erro ao atualizar solicitação:', err);
    }
  };

  const handleDeleteRequest = async (row: RequestRow) => {
    if (!user || !isSupabaseConfigured()) return;
    if (!window.confirm('Excluir esta solicitação permanentemente? Esta ação não pode ser desfeita.')) return;
    try {
      await db.delete('requests', row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      invalidatePendingRequestsCachesForUsers([user.id, row.user_id]);
      toast.addToast('success', 'Solicitação excluída.');
      try {
        await LoggingService.log({
          severity: LogSeverity.WARN,
          action: isAdminView ? 'ADMIN_DELETE_REQUEST' : 'USER_DELETE_REQUEST',
          userId: user.id,
          userName: user.nome,
          companyId: user.companyId,
          details: { requestId: row.id },
        });
      } catch {
        /* log opcional */
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : 'Falha ao excluir.';
      console.error('Erro ao excluir solicitação:', err);
      toast.addToast(
        'error',
        msg.includes('row-level') || msg.includes('permission') || msg.includes('policy')
          ? 'Permissão negada ao excluir. Aplique a migração requests_delete_policy no Supabase ou fale com o administrador.'
          : msg,
      );
    }
  };

  const canDeleteRow = (row: RequestRow) =>
    isAdminView || row.user_id === user?.id;

  if (loading) {
    return <LoadingState message="Carregando solicitações..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Solicitações"
        subtitle={
          isAdminView
            ? 'Acompanhe e aprove solicitações dos colaboradores'
            : 'Solicite ajustes, férias ou mudanças de turno'
        }
        icon={<ClipboardList className="w-5 h-5" />}
        actions={
          !isAdminView && (
            <Button size="sm" onClick={openCreate}>
              <PlusCircle className="w-4 h-4" />
              Nova solicitação
            </Button>
          )
        }
      />

      {isLoadingData ? (
        <LoadingState message="Carregando solicitações..." />
      ) : (
        <DataTable<RequestRow>
          columns={[
            {
              key: 'type',
              header: 'Tipo',
              render: (row) => (
                <ExpandableTextCell label="Tipo" value={formatRequestType(row.type)} />
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <ExpandableTextCell label="Status" value={formatWorkflowStatus(row.status)} />
              ),
            },
            {
              key: 'adjustment',
              header: 'Batida solicitada',
              render: (row) => {
                const adj = getAdjustmentMeta(row);
                if (!adj) {
                  return <span className="text-slate-400 text-sm">—</span>;
                }
                const label =
                  TIPOS_BATIDA.find((t) => t.value === adj.punchType)?.label ?? adj.punchType;
                return (
                  <ExpandableTextCell
                    label="Batida"
                    value={`${adj.date} ${adj.time} · ${label}`}
                  />
                );
              },
            },
            {
              key: 'reason',
              header: 'Motivo',
              render: (row) => <ExpandableTextCell label="Motivo" value={row.reason} />,
            },
            {
              key: 'created_at',
              header: 'Criado em',
              render: (row) => (
                <ExpandableTextCell
                  label="Criado em"
                  value={new Date(row.created_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                />
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (row: RequestRow) => (
                <div className="flex justify-end flex-wrap gap-2">
                  {isAdminView && (row.status === 'pending' || row.status === 'pendente') && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatusChange(row, 'approved')}
                      >
                        Aceitar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleStatusChange(row, 'rejected')}
                      >
                        Rejeitar
                      </Button>
                    </>
                  )}
                  {canDeleteRow(row) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      onClick={() => handleDeleteRequest(row)}
                      title="Excluir solicitação"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
          data={rows}
        />
      )}

      <ModalForm
        title="Nova Solicitação"
        description="Crie uma solicitação de ajuste, férias ou mudança de turno."
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              className="w-full sm:w-auto"
              disabled={
                submitting ||
                !form.reason.trim() ||
                (form.type === 'adjustment' &&
                  (!form.adjustment_date.trim() || !form.adjustment_time.trim()))
              }
            >
              {submitting ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Tipo
          </label>
          <select
            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
          >
            <option value="adjustment">Ajuste de ponto</option>
            <option value="vacation">Férias</option>
            <option value="shift_change">Mudança de turno</option>
          </select>
          {form.type === 'adjustment' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Data da batida
                </label>
                <input
                  type="date"
                  className="mt-1 w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
                  value={form.adjustment_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, adjustment_date: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Horário
                </label>
                <input
                  type="time"
                  className="mt-1 w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
                  value={form.adjustment_time}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, adjustment_time: e.target.value }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Tipo de batida
                </label>
                <select
                  className="mt-1 w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
                  value={form.punch_type}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, punch_type: e.target.value }))
                  }
                >
                  {TIPOS_BATIDA.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Motivo
            </label>
            <textarea
              className="mt-1 w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm min-h-[100px]"
              value={form.reason}
              onChange={(e) =>
                setForm((f) => ({ ...f, reason: e.target.value }))
              }
            />
          </div>
        </div>
      </ModalForm>
    </div>
  );
};

export default RequestsPage;

