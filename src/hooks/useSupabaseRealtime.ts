import { useEffect } from 'react';
import { db, isSupabaseConfigured, type DbRealtimePayload } from '../services/supabaseClient';
import { SYSTEM_CONFIG } from '../config/system';

type EventType = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface RealtimeOptions<TPayload extends DbRealtimePayload = DbRealtimePayload> {
  table: string;
  filter?: string;
  events?: EventType[];
  onPayload: (payload: TPayload) => void;
}

/**
 * Hook genérico para inscrições realtime em tabelas do Supabase.
 *
 * Exemplo:
 * useSupabaseRealtime({
 *   table: 'time_records',
 *   onPayload: (payload) => { ... }
 * });
 */
export function useSupabaseRealtime<TPayload extends DbRealtimePayload = DbRealtimePayload>({
  table,
  filter,
  events = ['*'],
  onPayload,
}: RealtimeOptions<TPayload>) {
  useEffect(() => {
    if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') return;
    if (!isSupabaseConfigured()) return;
    let unsubscribe: (() => void) | undefined;

    try {
      unsubscribe = db.subscribe(table, (payload: DbRealtimePayload) => {
        if (events.includes('*') || events.includes(payload.eventType as EventType)) {
          onPayload(payload as TPayload);
        }
      }, filter);
    } catch (e) {
      console.error('Erro ao configurar realtime Supabase:', e);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [table, filter, events, onPayload]);
}

