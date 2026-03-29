import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { MapPin, PlusCircle } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, Input, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { LoggingService } from '../../services/loggingService';
import { LogSeverity } from '../../types';

interface WorkLocationRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

const LocationsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<WorkLocationRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<WorkLocationRow>({
    id: '',
    name: '',
    latitude: 0,
    longitude: 0,
    radius_meters: 100,
  });

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      try {
        const res =
          (await db.select(
            'work_locations',
            [{ column: 'company_id', operator: 'eq', value: user.companyId }],
            { column: 'name', ascending: true },
          )) ?? [];

        setRows(
          res.map((r: any) => ({
            id: r.id,
            name: r.name,
            latitude: r.latitude,
            longitude: r.longitude,
            radius_meters: r.radius_meters,
          })),
        );
      } catch (e) {
        console.error('Erro ao carregar localizações:', e);
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
      latitude: 0,
      longitude: 0,
      radius_meters: 100,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isSupabaseConfigured || !form.name) return;

    try {
      const id = crypto.randomUUID();
      await db.insert('work_locations', {
        id,
        company_id: user.companyId,
        name: form.name,
        latitude: form.latitude,
        longitude: form.longitude,
        radius_meters: form.radius_meters,
        created_at: new Date().toISOString(),
      });

      setRows((prev) => [...prev, { ...form, id }]);

      await LoggingService.log({
        severity: LogSeverity.INFO,
        action: 'CREATE_WORK_LOCATION',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { name: form.name },
      });

      setIsModalOpen(false);
    } catch (err) {
      console.error('Erro ao criar localização:', err);
    }
  };

  if (loading) {
    return <LoadingState message="Carregando localizações..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locais de Trabalho"
        subtitle="Defina pontos de geofencing para validação de GPS"
        icon={<MapPin className="w-5 h-5" />}
        actions={
          <Button size="sm" onClick={openCreate}>
            <PlusCircle className="w-4 h-4" />
            Novo local
          </Button>
        }
      />

      {isLoadingData ? (
        <LoadingState message="Carregando locais..." />
      ) : (
        <DataTable<WorkLocationRow>
          columns={[
            { key: 'name', header: 'Nome' },
            {
              key: 'latitude',
              header: 'Latitude',
              render: (row) => row.latitude.toFixed(5),
            },
            {
              key: 'longitude',
              header: 'Longitude',
              render: (row) => row.longitude.toFixed(5),
            },
            {
              key: 'radius_meters',
              header: 'Raio (m)',
            },
          ]}
          data={rows}
        />
      )}

      <ModalForm
        title="Novo Local de Trabalho"
        description="Defina coordenadas e raio de validação."
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
          <Input
            label="Latitude"
            type="number"
            step="any"
            value={form.latitude}
            onChange={(e) =>
              setForm((f) => ({ ...f, latitude: Number(e.target.value) }))
            }
          />
          <Input
            label="Longitude"
            type="number"
            step="any"
            value={form.longitude}
            onChange={(e) =>
              setForm((f) => ({ ...f, longitude: Number(e.target.value) }))
            }
          />
          <Input
            label="Raio (metros)"
            type="number"
            value={form.radius_meters}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                radius_meters: Number(e.target.value || 0),
              }))
            }
          />
        </div>
      </ModalForm>
    </div>
  );
};

export default LocationsPage;

