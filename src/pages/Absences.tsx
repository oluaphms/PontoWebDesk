import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CircleOff } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, Input, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';

interface AbsenceRow {
  id: string;
  user_id: string;
  absence_date: string;
  type: string;
  reason: string;
  created_at: string;
}

const AbsencesPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<AbsenceRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<{ absence_date: string; type: string; reason: string }>({
    absence_date: '',
    type: 'justified',
    reason: '',
  });

  const isAdminView = user?.role === 'admin' || user?.role === 'hr';

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    let cancelled = false;
    const load = async () => {
      setIsLoadingData(true);
      setLoadError(null);
      try {
        const filters: { column: string; operator: string; value: any }[] = [];
        if (!isAdminView) {
          filters.push({ column: 'user_id', operator: 'eq', value: user.id });
        }
        const res =
          (await db.select(
            'absences',
            filters,
            { column: 'absence_date', ascending: false },
          )) ?? [];

        if (cancelled) return;
        setRows(
          res.map((r: any) => ({
            id: r.id,
            user_id: r.user_id,
            absence_date: r.absence_date,
            type: r.type,
            reason: r.reason,
            created_at: r.created_at,
          })),
        );
      } catch (e: any) {
        if (!cancelled) {
          const msg = e?.message || 'Falha ao carregar dados.';
          setLoadError(msg);
          console.error('Erro ao carregar ausências:', e);
        }
      } finally {
        if (!cancelled) setIsLoadingData(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [user, isAdminView]);

  const openCreate = () => {
    setForm({
      absence_date: '',
      type: 'justified',
      reason: '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isSupabaseConfigured || !form.absence_date || !form.reason) return;

    try {
      const id = crypto.randomUUID();
      await db.insert('absences', {
        id,
        user_id: user.id,
        absence_date: form.absence_date,
        type: form.type,
        reason: form.reason,
        created_at: new Date().toISOString(),
      });

      setRows((prev) => [
        {
          id,
          user_id: user.id,
          absence_date: form.absence_date,
          type: form.type,
          reason: form.reason,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);

      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'REGISTER_ABSENCE',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { absence_date: form.absence_date, type: form.type },
      });

      setIsModalOpen(false);
    } catch (err) {
      console.error('Erro ao registrar ausência:', err);
    }
  };

  if (loading) {
    return <LoadingState message="Carregando sessão..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ausências"
        subtitle="Registre e acompanhe ausências justificadas ou não"
        icon={<CircleOff className="w-5 h-5" />}
        actions={
          <Button size="sm" onClick={openCreate}>
            Registrar ausência
          </Button>
        }
      />

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          {loadError}
        </div>
      )}

      {isLoadingData ? (
        <LoadingState message="Carregando ausências..." />
      ) : (
        <DataTable<AbsenceRow>
          columns={[
            {
              key: 'absence_date',
              header: 'Data',
              render: (row) =>
                new Date(row.absence_date).toLocaleDateString('pt-BR'),
            },
            { key: 'type', header: 'Tipo' },
            { key: 'reason', header: 'Motivo' },
          ]}
          data={rows}
        />
      )}

      <ModalForm
        title="Registrar Ausência"
        description="Informe data, tipo e motivo da ausência."
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
            <Button type="submit" size="sm" disabled={!form.absence_date || !form.reason}>
              Salvar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Data"
            type="date"
            value={form.absence_date}
            onChange={(e) =>
              setForm((f) => ({ ...f, absence_date: e.target.value }))
            }
          />
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Tipo
          </label>
          <select
            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
          >
            <option value="justified">Justificada</option>
            <option value="unjustified">Não justificada</option>
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

export default AbsencesPage;

