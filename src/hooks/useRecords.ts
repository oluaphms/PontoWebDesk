import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TimeRecord, LogType, PunchMethod } from '../../types';
import { PontoService, getRecordCreatedAtDate } from '../../services/pontoService';
import { OfflinePunchService } from '../../services/offlinePunchService';
import { getTimeRecordsByUser } from '../../services/timeRecords.service';
import { invalidateAfterPunch } from '../services/queryCache';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { isLowNetworkMode } from '../performance/networkMode';
import { startDeferredRealtime } from '../performance/deferredRealtime';
import { normalizePunchRegistrationError, registerPunchSecure } from '../rep/repEngine';
import { PUNCH_SOURCE_WEB } from '../constants/punchSource';

function normalizeDbTimeRecord(row: Record<string, unknown>): TimeRecord | null {
  const id = String(row.id ?? '').trim();
  if (!id) return null;
  const createdAt = getRecordCreatedAtDate(row);
  if (!createdAt) return null;
  return {
    id,
    userId: String(row.user_id ?? row.userId ?? ''),
    companyId: String(row.company_id ?? row.companyId ?? ''),
    type: (row.type as LogType) ?? LogType.IN,
    method: (row.method as PunchMethod) ?? PunchMethod.MANUAL,
    photoUrl: row.photo_url != null ? String(row.photo_url) : undefined,
    location: row.location as TimeRecord['location'],
    justification: row.justification != null ? String(row.justification) : undefined,
    createdAt,
    ipAddress: String(row.ip_address ?? row.ipAddress ?? ''),
    deviceId: String(row.device_id ?? row.deviceId ?? ''),
    fraudFlags: (row.fraud_flags ?? row.fraudFlags ?? []) as TimeRecord['fraudFlags'],
    deviceInfo: (row.device_info ?? row.deviceInfo ?? {
      browser: '',
      os: '',
      isMobile: false,
      userAgent: '',
    }) as TimeRecord['deviceInfo'],
    adjustments: (row.adjustments ?? []) as TimeRecord['adjustments'],
  };
}

export const useRecords = (userId: string | undefined, companyId: string | undefined) => {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Cache com staleTime zero: dados do relógio chegam a cada 10-15s,
  // não faz sentido manter cache de 1 minuto.
  const { data: records = [], isLoading, refetch } = useQuery({
    queryKey: ['records', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const rows = await getTimeRecordsByUser(userId, 50, 0);
        return (rows ?? [])
          .map((row) => normalizeDbTimeRecord(row as Record<string, unknown>))
          .filter((row): row is TimeRecord => row !== null);
      } catch {
        return [];
      }
    },
    enabled: !!userId,
    staleTime: 0,
  });

  const [realtimeReady, setRealtimeReady] = useState(false);
  useEffect(() => {
    if (!userId || !companyId) {
      setRealtimeReady(false);
      return;
    }
    setRealtimeReady(false);
    return startDeferredRealtime(() => setRealtimeReady(true));
  }, [userId, companyId]);

  // Realtime: invalida cache automaticamente quando time_records recebe INSERT
  // Adiado até idle pós-mount para não competir com paint do login/dashboard.
  useEffect(() => {
    if (!userId || !companyId || !realtimeReady) return;

    let batchedTimer: ReturnType<typeof setTimeout> | null = null;
    const debounceMs = isLowNetworkMode() ? 900 : 380;

    const scheduleRealtimeCoalesce = () => {
      if (batchedTimer) return;
      batchedTimer = setTimeout(() => {
        batchedTimer = null;
        queryClient.invalidateQueries({ queryKey: ['records', userId] }, { force: true });
        invalidateAfterPunch(userId, companyId);
      }, debounceMs);
    };

    const unsubscribe = db.subscribe(
      'time_records',
      () => {
        scheduleRealtimeCoalesce();
      },
      `user_id=eq.${userId}`,
    );

    return () => {
      if (batchedTimer) clearTimeout(batchedTimer);
      unsubscribe();
    };
  }, [userId, companyId, queryClient, realtimeReady]);

  const refreshRecords = useCallback(async (force = false) => {
    if (force) {
      await refetch();
    }
  }, [refetch]);

  const lastPunchAt = useRef<number>(0);
  const THROTTLE_MS = 5000;

  const isBase64Photo = (photo?: string) =>
    typeof photo === 'string' && photo.startsWith('data:image');

  const canUseSecurePunch = (method: PunchMethod, data: any) =>
    isSupabaseConfigured() &&
    (typeof navigator === 'undefined' || navigator.onLine !== false) &&
    method !== PunchMethod.MANUAL &&
    !data?.justification &&
    !isBase64Photo(data?.photo);

  const syncOfflineQueue = useCallback(async () => {
    if (!userId || !companyId) return;
    const queue = OfflinePunchService.getQueue();
    if (!queue.length) return;

    const toSync = queue.filter(
      (item) => item.userId === userId && item.companyId === companyId
    );
    if (!toSync.length) return;

    const syncedIds: string[] = [];

    for (const item of toSync) {
      try {
        if (canUseSecurePunch(item.method, item.data)) {
          await registerPunchSecure({
            userId: item.userId,
            companyId: item.companyId,
            type: item.type as string,
            method: item.method,
            location: item.data.location
              ? {
                  lat: item.data.location.lat,
                  lng: item.data.location.lng,
                  accuracy: item.data.location.accuracy,
                }
              : undefined,
            photoUrl: item.data.photo || undefined,
            source: PUNCH_SOURCE_WEB,
            latitude: item.data.location?.lat ?? null,
            longitude: item.data.location?.lng ?? null,
            accuracy: item.data.location?.accuracy ?? null,
          });
        } else {
          await PontoService.registerPunch(
            item.userId,
            item.companyId,
            item.type,
            item.method,
            item.data.location,
            item.data.photo,
            item.data.justification
          );
        }
        syncedIds.push(item.id);
        // ✅ OTIMIZADO: Invalidar cache após sincronizar
        queryClient.invalidateQueries({ queryKey: ['records', userId] }, { force: true });
        invalidateAfterPunch(userId, companyId);
      } catch (err) {
        // Se falhar, mantém na fila para tentar depois
        observabilityConsole.warn('Falha ao sincronizar ponto offline, tentando novamente depois.', err);
      }
    }

    if (syncedIds.length) {
      OfflinePunchService.removeByIds(syncedIds);
    }
  }, [userId, companyId, queryClient]);

  const addRecord = async (type: LogType, method: PunchMethod, data: any) => {
    if (!userId || !companyId) return;
    const now = Date.now();
    if (now - lastPunchAt.current < THROTTLE_MS) {
      setError('Aguarde alguns segundos antes de registrar novamente.');
      return;
    }
    lastPunchAt.current = now;
    setError(null);
    try {
      const newRecord = canUseSecurePunch(method, data)
        ? await registerPunchSecure({
            userId,
            companyId,
            type: type as string,
            method,
            location: data.location
              ? {
                  lat: data.location.lat,
                  lng: data.location.lng,
                  accuracy: data.location.accuracy,
                }
              : undefined,
            photoUrl: data.photo || undefined,
            source: PUNCH_SOURCE_WEB,
            latitude: data.location?.lat ?? null,
            longitude: data.location?.lng ?? null,
            accuracy: data.location?.accuracy ?? null,
          })
        : await PontoService.registerPunch(
            userId,
            companyId,
            type,
            method,
            data.location,
            data.photo,
            data.justification
          );
      // ✅ OTIMIZADO: Invalidar cache após registrar ponto
      queryClient.invalidateQueries({ queryKey: ['records', userId] }, { force: true });
      invalidateAfterPunch(userId, companyId);
      return newRecord;
    } catch (err: any) {
      // Modo offline básico: se estiver sem conexão, enfileirar o registro
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        OfflinePunchService.enqueue(userId, companyId, type, method, {
          location: data.location,
          photo: data.photo,
          justification: data.justification,
        });
        setError('Sem conexão. Seu ponto foi salvo offline e será sincronizado depois.');
        return;
      }
      const normalized = normalizePunchRegistrationError(err);
      setError(normalized.message || 'Erro desconhecido ao registrar ponto.');
      throw err;
    }
  };

  // Sincronizar fila offline quando voltar a ficar online
  useEffect(() => {
    if (!userId || !companyId) return;

    // Tenta uma sincronização inicial
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      syncOfflineQueue();
    }

    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      syncOfflineQueue();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [userId, companyId, syncOfflineQueue]);

  return { records, isLoading, error, setError, addRecord, refreshRecords };
};
