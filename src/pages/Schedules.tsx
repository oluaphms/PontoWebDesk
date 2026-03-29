import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarRange, PlusCircle } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, Input, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { NotificationService } from '../../services/notificationService';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';

interface WorkScheduleRow {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_start?: string | null;
  break_end?: string | null;
  tolerance_minutes?: number | null;
}

const SchedulesPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<WorkScheduleRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<WorkScheduleRow>({
    id: '',
    name: '',
    start_time: '09:00',
    end_time: '18:00',
    break_start: '12:00',
    break_end: '13:00',
    tolerance_minutes: 10,
  });

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      try {
        const res =
          (await db.select(
            'work_schedules',
            [{ column: 'company_id', operator: 'eq', value: user.companyId }],
            { column: 'name', ascending: true },
          )) ?? [];

        setRows(
          res.map((r: any) => ({
            id: r.id,
            name: r.name,
            start_time: r.start_time,
            end_time: r.end_time,
            break_start: r.break_start,
            break_end: r.break_end,
            tolerance_minutes: r.tolerance_minutes,
          })),
        );
      } catch (e) {
        console.error('Erro ao carregar escalas:', e);
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user]);

  const openCreate = () => {
    setForm({
      id: '',
      name: '',
      start_time: '09:00',
      end_time: '18:00',
      break_start: '12:00',
      break_end: '13:00',
      tolerance_minutes: 10,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isSupabaseConfigured || !form.name) return;

    try {
      const id = crypto.randomUUID();
      await db.insert('work_schedules', {
        id,
        company_id: user.companyId,
        name: form.name,
        start_time: form.start_time,
        end_time: form.end_time,
        break_start: form.break_start,
        break_end: form.break_end,
        tolerance_minutes: form.tolerance_minutes ?? 0,
        created_at: new Date().toISOString(),
      });

      setRows((prev) => [
        ...prev,
        {
          ...form,
          id,
        },
      ]);

      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'CREATE_WORK_SCHEDULE',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { name: form.name },
      });

      setIsModalOpen(false);
    } catch (err) {
      console.error('Erro ao criar escala:', err);
    }
  };

  if (loading) {
    return <LoadingState message="Carregando escalas..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Escalas de Trabalho"
        subtitle="Configure horários padrão e tolerâncias"
        icon={<CalendarRange className="w-5 h-5" />}
        actions={
          <Button size="sm" onClick={openCreate}>
            <PlusCircle className="w-4 h-4" />
            Nova escala
          </Button>
        }
      />

      {isLoadingData ? (
        <LoadingState message="Carregando escalas..." />
      ) : (
        <DataTable<WorkScheduleRow>
          columns={[
            { key: 'name', header: 'Nome' },
            {
              key: 'start_time',
              header: 'Início',
              render: (row) => row.start_time,
            },
            {
              key: 'end_time',
              header: 'Fim',
              render: (row) => row.end_time,
            },
            {
              key: 'break',
              header: 'Intervalo',
              render: (row) =>
                row.break_start && row.break_end
                  ? `${row.break_start} - ${row.break_end}`
                  : '-',
            },
            {
              key: 'tolerance_minutes',
              header: 'Tolerância (min)',
              render: (row) => row.tolerance_minutes ?? 0,
            },
          ]}
          data={rows}
        />
      )}

      <ModalForm
        title="Nova Escala"
        description="Defina horários padrão da jornada de trabalho."
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
            <Button type="submit" size="sm" disabled={!form.name}>
              Salvar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Nome"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Início"
              type="time"
              value={form.start_time}
              onChange={(e) =>
                setForm((f) => ({ ...f, start_time: e.target.value }))
              }
            />
            <Input
              label="Fim"
              type="time"
              value={form.end_time}
              onChange={(e) =>
                setForm((f) => ({ ...f, end_time: e.target.value }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Início intervalo"
              type="time"
              value={form.break_start ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, break_start: e.target.value || null }))
              }
            />
            <Input
              label="Fim intervalo"
              type="time"
              value={form.break_end ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, break_end: e.target.value || null }))
              }
            />
          </div>
          <Input
            label="Tolerância (min)"
            type="number"
            value={form.tolerance_minutes ?? 0}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                tolerance_minutes: Number(e.target.value || 0),
              }))
            }
          />
        </div>
      </ModalForm>
    </div>
  );
};

export default SchedulesPage;

