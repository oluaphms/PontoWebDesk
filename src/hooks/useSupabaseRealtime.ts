import { useEffect } from 'react';
import type { DbRealtimePayload } from '../services/supabaseClient';

type EventType = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface RealtimeOptions<TPayload extends DbRealtimePayload = DbRealtimePayload> {
  table: string;
  filter?: string;
  events?: EventType[];
  onPayload: (payload: TPayload) => void;
}

/** Realtime desativado — dados via API HTTP na VPS. */
export function useSupabaseRealtime<TPayload extends DbRealtimePayload = DbRealtimePayload>(
  _opts: RealtimeOptions<TPayload>,
): void {
  useEffect(() => {
    return () => {};
  }, []);
}
