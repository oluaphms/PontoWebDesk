
import { useState, useEffect, useCallback, useRef } from 'react';
import { TimeRecord, LogType, PunchMethod } from '../types';
import { PontoService } from '../services/pontoService';

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
      console.error("Failed to fetch records", err);
    }
  }, [userId]);

  useEffect(() => {
    refreshRecords();
  }, [refreshRecords]);

  const addRecord = async (type: LogType, method: PunchMethod, data: any) => {
    if (!userId || !companyId) return;
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
      setRecords(prev => [newRecord, ...prev]);
      return newRecord;
    } catch (err: any) {
      setError(err.message || "Erro desconhecido ao registrar ponto.");
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { records, isLoading, error, setError, addRecord, refreshRecords };
};
