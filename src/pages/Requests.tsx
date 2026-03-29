import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ClipboardList, PlusCircle } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, Input, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { NotificationService } from '../../services/notificationService';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';

interface RequestRow {
  id: string;
  type: string;
  status: string;
  reason: string;
  created_at: string;
  user_id: string;
}

const RequestsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<{ type: string; reason: string }>({
    type: 'adjustment',
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
            'requests',
            filters,
            { column: 'created_at', ascending: false },
          )) ?? [];

        setRows(
          res.map((r: any) => ({
            id: r.id,
            type: r.type,
            status: r.status,
            reason: r.reason,
            created_at: r.created_at,
            user_id: r.user_id,
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
    setForm({ type: 'adjustment', reason: '' });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isSupabaseConfigured || !form.reason) return;

    try {
      const id = crypto.randomUUID();
      await db.insert('requests', {
        id,
        user_id: user.id,
        type: form.type,
        status: 'pending',
        reason: form.reason,
        created_at: new Date().toISOString(),
      });

      setRows((prev) => [
        {
          id,
          user_id: user.id,
          type: form.type,
          status: 'pending',
          reason: form.reason,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);

      await NotificationService.create({
        userId: user.id,
        type: 'info',
        title: 'Solicitação enviada',
        message: 'Sua solicitação foi registrada e aguarda aprovação.',
      });

      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'USER_CREATE_REQUEST',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { type: form.type },
      });

      setIsModalOpen(false);
    } catch (err) {
      console.error('Erro ao criar solicitação:', err);
    }
  };

  const handleStatusChange = async (row: RequestRow, status: 'approved' | 'rejected') => {
    if (!user || !isSupabaseConfigured) return;

    try {
      await db.update('requests', row.id, {
        status,
      });

      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status } : r)),
      );

      await NotificationService.create({
        userId: row.user_id,
        type: status === 'approved' ? 'success' : 'warning',
        title: 'Solicitação atualizada',
        message:
          status === 'approved'
            ? 'Sua solicitação foi aprovada.'
            : 'Sua solicitação foi rejeitada.',
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
            { key: 'type', header: 'Tipo' },
            { key: 'status', header: 'Status' },
            {
              key: 'reason',
              header: 'Motivo',
            },
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
                    render: (row: RequestRow) =>
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
        title="Nova Solicitação"
        description="Crie uma solicitação de ajuste, férias ou mudança de turno."
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

