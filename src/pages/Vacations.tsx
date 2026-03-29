import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { PlaneTakeoff } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, Input, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { NotificationService } from '../../services/notificationService';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';

interface VacationRow {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
}

const VacationsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<VacationRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<{ start_date: string; end_date: string }>({
    start_date: '',
    end_date: '',
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
            'vacations',
            filters,
            { column: 'created_at', ascending: false },
          )) ?? [];

        setRows(
          res.map((r: any) => ({
            id: r.id,
            user_id: r.user_id,
            start_date: r.start_date,
            end_date: r.end_date,
            status: r.status,
            created_at: r.created_at,
          })),
        );
      } catch (e) {
        console.error('Erro ao carregar férias:', e);
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user, isAdminView]);

  const openCreate = () => {
    setForm({
      start_date: '',
      end_date: '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isSupabaseConfigured || !form.start_date || !form.end_date) return;

    try {
      const id = crypto.randomUUID();
      await db.insert('vacations', {
        id,
        user_id: user.id,
        start_date: form.start_date,
        end_date: form.end_date,
        status: 'pending',
        created_at: new Date().toISOString(),
      });

      setRows((prev) => [
        {
          id,
          user_id: user.id,
          start_date: form.start_date,
          end_date: form.end_date,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);

      await NotificationService.create({
        userId: user.id,
        type: 'info',
        title: 'Férias solicitadas',
        message: 'Seu pedido de férias foi registrado.',
      });

      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'USER_REQUEST_VACATION',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { start_date: form.start_date, end_date: form.end_date },
      });

      setIsModalOpen(false);
    } catch (err) {
      console.error('Erro ao criar férias:', err);
    }
  };

  const handleStatusChange = async (row: VacationRow, status: 'approved' | 'rejected') => {
    if (!user || !isSupabaseConfigured) return;

    try {
      await db.update('vacations', row.id, {
        status,
      });

      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status } : r)),
      );

      await NotificationService.create({
        userId: row.user_id,
        type: status === 'approved' ? 'success' : 'warning',
        title: 'Férias atualizadas',
        message:
          status === 'approved'
            ? 'Suas férias foram aprovadas.'
            : 'Suas férias foram rejeitadas.',
      });

      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'ADMIN_UPDATE_VACATION',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { vacationId: row.id, status },
      });
    } catch (err) {
      console.error('Erro ao atualizar férias:', err);
    }
  };

  if (loading) {
    return <LoadingState message="Carregando férias..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Férias"
        subtitle={
          isAdminView
            ? 'Aprove ou rejeite pedidos de férias'
            : 'Solicite e acompanhe suas férias'
        }
        icon={<PlaneTakeoff className="w-5 h-5" />}
        actions={
          !isAdminView && (
            <Button size="sm" onClick={openCreate}>
              Solicitar férias
            </Button>
          )
        }
      />

      {isLoadingData ? (
        <LoadingState message="Carregando férias..." />
      ) : (
        <DataTable<VacationRow>
          columns={[
            {
              key: 'start_date',
              header: 'Início',
              render: (row) =>
                new Date(row.start_date).toLocaleDateString('pt-BR'),
            },
            {
              key: 'end_date',
              header: 'Fim',
              render: (row) =>
                new Date(row.end_date).toLocaleDateString('pt-BR'),
            },
            { key: 'status', header: 'Status' },
            ...(isAdminView
              ? [
                  {
                    key: 'actions',
                    header: '',
                    render: (row: VacationRow) =>
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
        title="Solicitar Férias"
        description="Informe o período desejado para as férias."
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
            <Button type="submit" size="sm" disabled={!form.start_date || !form.end_date}>
              Enviar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Data de início"
            type="date"
            value={form.start_date}
            onChange={(e) =>
              setForm((f) => ({ ...f, start_date: e.target.value }))
            }
          />
          <Input
            label="Data de fim"
            type="date"
            value={form.end_date}
            onChange={(e) =>
              setForm((f) => ({ ...f, end_date: e.target.value }))
            }
          />
        </div>
      </ModalForm>
    </div>
  );
};

export default VacationsPage;

