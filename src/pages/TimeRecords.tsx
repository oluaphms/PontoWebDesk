import { observabilityConsole } from '../shared/logger/observabilityConsole';
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { isSupabaseConfigured, type Filter } from '../services/supabaseClient';
import { listTimeRecords } from '../../services/timeRecords.service';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import { LoadingState, Input } from '../../components/UI';
import { LogType } from '../../types';
import { MapPin, MonitorSmartphone, ListOrdered } from 'lucide-react';
import { extractLatLng } from '../utils/reverseGeocode';
import { StreetAddress } from '../components/StreetAddress';

interface TimeRecordRow {
  id: string;
  created_at: string;
  type: string;
  location: any;
  latitude?: number | null;
  longitude?: number | null;
  device_id?: string | null;
}

function localDateStartIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return `${ymd}T00:00:00.000Z`;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function localDateEndIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return `${ymd}T23:59:59.999Z`;
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

const TimeRecordsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<TimeRecordRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!user || !isSupabaseConfigured()) return;

    const load = async () => {
      setIsLoadingData(true);
      try {
        const filters: Filter[] = [
          { column: 'user_id', operator: 'eq', value: user.id },
        ];
        if (dateFrom) {
          filters.push({ column: 'created_at', operator: 'gte', value: localDateStartIso(dateFrom) });
        }
        if (dateTo) {
          filters.push({ column: 'created_at', operator: 'lte', value: localDateEndIso(dateTo) });
        }

        // Otimização: carregar apenas colunas necessárias com limite
        const res =
          (await listTimeRecords(filters, {
            columns: 'id, created_at, type, location, latitude, longitude, device_id',
            orderBy: { column: 'created_at', ascending: false },
            limit: 200,
          })) ?? [];

        setRows(
          res.map((r: any) => ({
            id: r.id,
            created_at: r.created_at,
            type: r.type,
            location: r.location,
            latitude: r.latitude,
            longitude: r.longitude,
            device_id: r.device_id,
          })),
        );
      } catch (e) {
        observabilityConsole.error('Erro ao carregar registros de ponto:', e);
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user, dateFrom, dateTo, refreshNonce]);

  useEffect(() => {
    const onSynced = () => setRefreshNonce((n) => n + 1);
    window.addEventListener('pontowebdesk:web-punch-synced', onSynced as EventListener);
    return () => {
      window.removeEventListener('pontowebdesk:web-punch-synced', onSynced as EventListener);
    };
  }, []);

  if (loading) {
    return <LoadingState message="Carregando registros..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Registros de Ponto"
        subtitle="Histórico detalhado das suas marcações"
        icon={<ListOrdered className="w-5 h-5" />}
      />

      <div className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            label="Data inicial"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <Input
            label="Data final"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          <div className="flex items-end text-xs text-slate-500 dark:text-slate-400">
            <p>Filtra pelas datas de criação dos registros.</p>
          </div>
        </div>
      </div>

      {isLoadingData ? (
        <LoadingState message="Carregando registros de ponto..." />
      ) : (
        <DataTable<TimeRecordRow>
          columns={[
            {
              key: 'created_at',
              header: 'Data',
              render: (row) =>
                new Date(row.created_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                }),
            },
            {
              key: 'type',
              header: 'Tipo',
              render: (row) => {
                switch (row.type as LogType) {
                  case LogType.IN:
                    return 'Entrada';
                  case LogType.OUT:
                    return 'Saída';
                  case LogType.BREAK:
                    return 'Pausa';
                  default:
                    return row.type;
                }
              },
            },
            {
              key: 'created_at',
              header: 'Horário',
              render: (row) =>
                new Date(row.created_at).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
            },
            {
              key: 'location',
              header: 'Localização',
              render: (row) => {
                const ll = extractLatLng(row);
                return ll ? (
                  <span className="inline-flex items-start gap-1 text-xs text-slate-600 dark:text-slate-300 max-w-[240px]">
                    <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                    <StreetAddress lat={ll.lat} lng={ll.lng} />
                  </span>
                ) : (
                  '-'
                );
              },
            },
            {
              key: 'device_id',
              header: 'Dispositivo',
              render: (row) =>
                row.device_id ? (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                    <MonitorSmartphone className="w-3 h-3" />
                    {row.device_id}
                  </span>
                ) : (
                  '-'
                ),
            },
          ]}
          data={rows}
        />
      )}
    </div>
  );
};

export default TimeRecordsPage;

