import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Cpu, PlusCircle } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, Input, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';

interface DeviceRow {
  id: string;
  name: string;
  device_identifier: string;
  status: string;
}

const DevicesPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<DeviceRow>({
    id: '',
    name: '',
    device_identifier: '',
    status: 'active',
  });

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      try {
        const res =
          (await db.select(
            'devices',
            [{ column: 'company_id', operator: 'eq', value: user.companyId }],
            { column: 'name', ascending: true },
          )) ?? [];

        setRows(
          res.map((r: any) => ({
            id: r.id,
            name: r.name,
            device_identifier: r.device_identifier,
            status: r.status,
          })),
        );
      } catch (e) {
        console.error('Erro ao carregar dispositivos:', e);
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
      device_identifier: '',
      status: 'active',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isSupabaseConfigured || !form.name || !form.device_identifier) return;

    try {
      const id = crypto.randomUUID();
      await db.insert('devices', {
        id,
        company_id: user.companyId,
        name: form.name,
        device_identifier: form.device_identifier,
        status: form.status,
        created_at: new Date().toISOString(),
      });

      setRows((prev) => [...prev, { ...form, id }]);

      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'CREATE_DEVICE',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { name: form.name, identifier: form.device_identifier },
      });

      setIsModalOpen(false);
    } catch (err) {
      console.error('Erro ao criar dispositivo:', err);
    }
  };

  if (loading) {
    return <LoadingState message="Carregando dispositivos..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispositivos"
        subtitle="Gerencie dispositivos autorizados para marcação"
        icon={<Cpu className="w-5 h-5" />}
        actions={
          <Button size="sm" onClick={openCreate}>
            <PlusCircle className="w-4 h-4" />
            Novo dispositivo
          </Button>
        }
      />

      {isLoadingData ? (
        <LoadingState message="Carregando dispositivos..." />
      ) : (
        <DataTable<DeviceRow>
          columns={[
            { key: 'name', header: 'Nome' },
            { key: 'device_identifier', header: 'Identificador' },
            { key: 'status', header: 'Status' },
          ]}
          data={rows}
        />
      )}

      <ModalForm
        title="Novo Dispositivo"
        description="Cadastre identificadores confiáveis para o controle de ponto."
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
            <Button type="submit" size="sm" disabled={!form.name || !form.device_identifier}>
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
          <Input
            label="Identificador do dispositivo"
            value={form.device_identifier}
            onChange={(e) =>
              setForm((f) => ({ ...f, device_identifier: e.target.value }))
            }
            required
          />
        </div>
      </ModalForm>
    </div>
  );
};

export default DevicesPage;

