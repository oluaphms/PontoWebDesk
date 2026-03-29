import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { MapPin, PlayCircle } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import TimeClockButtons from '../components/TimeClockButtons';
import { useToast } from '../components/ToastProvider';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { registerPunch } from '../rep/repEngine';
import { LogType, PunchMethod } from '../../types';
import { LoggingService } from '../../services/loggingService';
import { NotificationService } from '../../services/notificationService';
import { LoadingState } from '../../components/UI';

interface SimpleRecord {
  id: string;
  type: LogType;
  created_at: string;
}

const TimeClockPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const toast = useToast();
  const [lastRecord, setLastRecord] = useState<SimpleRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    const load = async () => {
      try {
        const rows =
          (await db.select(
            'time_records',
            [{ column: 'user_id', operator: 'eq', value: user.id }],
            { column: 'created_at', ascending: false },
            1,
          )) ?? [];
        if (rows.length > 0) {
          const r = rows[0];
          setLastRecord({
            id: r.id,
            type: r.type as LogType,
            created_at: r.created_at,
          });
        } else {
          setLastRecord(null);
        }
      } catch (e) {
        console.error('Erro ao buscar último registro de ponto:', e);
      }
    };
    load();
  }, [user]);

  const handlePunch = async (type: LogType) => {
    if (!user || !isSupabaseConfigured) return;

    setIsSaving(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocalização não suportada pelo navegador.'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const result = await registerPunch({
        userId: user.id,
        companyId: user.companyId,
        type: type as string,
        method: PunchMethod.GPS,
        recordId: crypto.randomUUID(),
        location: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        },
        source: 'web',
      });

      setLastRecord({
        id: result.id,
        type,
        created_at: result.timestamp,
      });

      await LoggingService.log({
        severity: 'info',
        action: 'EMPLOYEE_CLOCK_EVENT',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: { type, method: 'gps' },
      });

      await NotificationService.create({
        userId: user.id,
        type: 'success',
        title: 'Ponto registrado',
        message: 'Seu registro de ponto foi salvo com sucesso.',
      });

      toast.addToast('success', 'Registro de ponto criado com sucesso.');
    } catch (e: any) {
      console.error('Erro ao registrar ponto:', e);
      toast.addToast('error', e?.message || 'Erro ao registrar ponto.');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return <LoadingState message="Carregando tela de marcação..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Marcação de Ponto"
        subtitle="Registre entradas, pausas e saídas com validação de GPS"
        icon={<PlayCircle className="w-5 h-5" />}
      />

      <div className="glass-card rounded-[3rem] p-8 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Último registro
            </p>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-1">
              {lastRecord
                ? `${lastRecord.type} às ${new Date(lastRecord.created_at).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Nenhum registro encontrado'}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <MapPin className="w-4 h-4" />
            <span>Localização será capturada automaticamente</span>
          </div>
        </div>

        <TimeClockButtons
          isLoading={isSaving}
          lastType={lastRecord?.type ?? null}
          onPunch={handlePunch}
        />
      </div>
    </div>
  );
};

export default TimeClockPage;

