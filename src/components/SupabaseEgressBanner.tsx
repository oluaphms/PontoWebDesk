import React, { useSyncExternalStore } from 'react';
import {
  isSupabaseEgressBlocked,
  subscribeSupabaseEgressBlocked,
  SUPABASE_EGRESS_QUOTA_MESSAGE,
} from '../services/supabaseEgressGuard';

function subscribe(cb: () => void) {
  return subscribeSupabaseEgressBlocked(cb);
}

function getSnapshot() {
  return isSupabaseEgressBlocked();
}

export const SupabaseEgressBanner: React.FC = () => {
  const blocked = useSyncExternalStore(subscribe, getSnapshot, () => false);
  if (!blocked) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        background: '#7f1d1d',
        color: '#fff',
        padding: '12px 16px',
        fontSize: '14px',
        lineHeight: 1.45,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>Supabase indisponível — cota de egress esgotada</strong>
      <span>{SUPABASE_EGRESS_QUOTA_MESSAGE}</span>{' '}
      <a
        href="https://supabase.help"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#fecaca', textDecoration: 'underline' }}
      >
        supabase.help
      </a>
    </div>
  );
};
