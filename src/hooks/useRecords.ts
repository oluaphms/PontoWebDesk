import { useState, useEffect, useCallback, useRef } from 'react';
import { TimeRecord, LogType, PunchMethod } from '../../types';
import { PontoService } from '../../services/pontoService';
import { OfflinePunchService } from '../../services/offlinePunchService';

export const useRecords = (userId: string | undefined, companyId: string | undefined) => {
  const [records, setRecords] = useState<TimeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track initial load to prevent multiple simultaneous calls
  const isFetched = useRef(false);

  const refreshRecords = useCallback(async (force = false) => {
    if (!userId) return;
    if (isFetched.current && !force) return;

    try {
      const data = await PontoService.getRecords(userId);
      setRecords(data);
      isFetched.current = true;
    } catch (err) {
      console.error('Failed to fetch records', err);
    }
  }, [userId]);

  useEffect(() => {
    refreshRecords();
  }, [refreshRecords]);

  const lastPunchAt = useRef<number>(0);
  const THROTTLE_MS = 5000;

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
        const newRecord = await PontoService.registerPunch(
          item.userId,
          item.companyId,
          item.type,
          item.method,
          item.data.location,
          item.data.photo,
          item.data.justification
        );
        syncedIds.push(item.id);
        setRecords((prev) => [newRecord, ...prev]);
      } catch (err) {
        // Se falhar, mantém na fila para tentar depois
        console.warn('Falha ao sincronizar ponto offline, tentando novamente depois.', err);
      }
    }

    if (syncedIds.length) {
      OfflinePunchService.removeByIds(syncedIds);
    }
  }, [userId, companyId]);

  const addRecord = async (type: LogType, method: PunchMethod, data: any) => {
    if (!userId || !companyId) return;
    const now = Date.now();
    if (now - lastPunchAt.current < THROTTLE_MS) {
      setError('Aguarde alguns segundos antes de registrar novamente.');
      return;
    }
    lastPunchAt.current = now;
    setIsLoading(true);
    setError(null);
    try {
      const newRecord = await PontoService.registerPunch(
        userId,
        companyId,
        type,
        method,
        data.location,
        data.photo,
        data.justification
      );
      setRecords((prev) => [newRecord, ...prev]);
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

      setError(err.message || 'Erro desconhecido ao registrar ponto.');
      throw err;
    } finally {
      setIsLoading(false);
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
