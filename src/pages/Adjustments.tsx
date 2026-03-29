import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Clock12 } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, Input, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { NotificationService } from '../../services/notificationService';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity, LogType } from '../../types';

interface AdjustmentRow {
  id: string;
  time_record_id: string;
  status: string;
  requested_time: string;
  reason: string;
  created_at: string;
  user_id: string;
}

const AdjustmentsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<{ time_record_id: string; requested_time: string; reason: string }>({
    time_record_id: '',
    requested_time: '09:00',
    reason: '',
  });

  const isAdminView = user?.role === 'admin' || user?.role === 'hr';

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      try {
        const filters: { column: string; operator: string; value: any }[] = [];
        if (!isAdminView) {
          filters.push({ column: 'user_id', operator: 'eq', value: user.id });
        }
        const res =
          (await db.select(
            'time_adjustments',
            filters,
            { column: 'created_at', ascending: false },
          )) ?? [];

        setRows(
          res.map((r: any) => ({
            id: r.id,
            time_record_id: r.time_record_id,
            status: r.status,
            requested_time: r.requested_time,
            reason: r.reason,
            created_at: r.created_at,
            user_id: r.user_id,
          })),
        );
      } catch (e) {
        console.error('Erro ao carregar ajustes:', e);
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user, isAdminView]);

  const openCreate = () => {
    setForm({ time_record_id: '', requested_time: '09:00', reason: '' });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isSupabaseConfigured || !form.reason) return;

    try {
      const id = crypto.randomUUID();
      await db.insert('time_adjustments', {
        id,
        user_id: user.id,
        time_record_id: form.time_record_id || null,
        requested_time: form.requested_time,
        status: 'pending',
        reason: form.reason,
        created_at: new Date().toISOString(),
      });

      setRows((prev) => [
        {
          id,
          user_id: user.id,
          time_record_id: form.time_record_id,
          requested_time: form.requested_time,
          status: 'pending',
          reason: form.reason,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);

      await NotificationService.create({
        userId: user.id,
        type: 'info',
        title: 'Ajuste solicitado',
        message: 'Seu pedido de ajuste foi registrado.',
      });

      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'USER_REQUEST_ADJUSTMENT',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { time_record_id: form.time_record_id },
      });

      setIsModalOpen(false);
    } catch (err) {
      console.error('Erro ao criar ajuste:', err);
    }
  };

  const handleStatusChange = async (row: AdjustmentRow, status: 'approved' | 'rejected') => {
    if (!user || !isSupabaseConfigured) return;

    try {
      await db.update('time_adjustments', row.id, {
        status,
      });

      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status } : r)),
      );

      // REP-P (Portaria 671): time_records são imutáveis. Ajustes aprovados ficam em time_adjustments
      // e devem ser considerados nos cálculos de jornada/relatórios (não alteramos time_records).

      await NotificationService.create({
        userId: row.user_id,
        type: status === 'approved' ? 'success' : 'warning',
        title: 'Ajuste atualizado',
        message:
          status === 'approved'
            ? 'Seu ajuste de ponto foi aprovado.'
            : 'Seu ajuste de ponto foi rejeitado.',
      });

      await LoggingService.log({
        severity:
          status === 'approved' ? LogSeverity.SECURITY : LogSeverity.WARN,
        action: 'ADMIN_UPDATE_ADJUSTMENT',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { adjustmentId: row.id, status },
      });
    } catch (err) {
      console.error('Erro ao atualizar ajuste:', err);
    }
  };

  if (loading) {
    return <LoadingState message="Carregando ajustes..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajustes de Ponto"
        subtitle={
          isAdminView
            ? 'Analise e aprove correções de registros'
            : 'Solicite correções nos seus registros de ponto'
        }
        icon={<Clock12 className="w-5 h-5" />}
        actions={
          !isAdminView && (
            <Button size="sm" onClick={openCreate}>
              Solicitar ajuste
            </Button>
          )
        }
      />

      {isLoadingData ? (
        <LoadingState message="Carregando ajustes..." />
      ) : (
        <DataTable<AdjustmentRow>
          columns={[
            {
              key: 'requested_time',
              header: 'Horário solicitado',
            },
            { key: 'status', header: 'Status' },
            { key: 'reason', header: 'Motivo' },
            {
              key: 'created_at',
              header: 'Criado em',
              render: (row) =>
                new Date(row.created_at).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
            },
            ...(isAdminView
              ? [
                  {
                    key: 'actions',
                    header: '',
                    render: (row: AdjustmentRow) =>
                      row.status === 'pending' && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStatusChange(row, 'approved')}
                          >
                            Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleStatusChange(row, 'rejected')}
                          >
                            Rejeitar
                          </Button>
                        </div>
                      ),
                  },
                ]
              : []),
          ]}
          data={rows}
        />
      )}

      <ModalForm
        title="Solicitar Ajuste"
        description="Informe o horário correto e o motivo da correção."
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        footer={
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={!form.reason}>
              Enviar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="ID do registro (opcional)"
            value={form.time_record_id}
            onChange={(e) =>
              setForm((f) => ({ ...f, time_record_id: e.target.value }))
            }
          />
          <Input
            label="Horário correto"
            type="time"
            value={form.requested_time}
            onChange={(e) =>
              setForm((f) => ({ ...f, requested_time: e.target.value }))
            }
          />
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

export default AdjustmentsPage;

