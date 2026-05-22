/**
 * Garante que variáveis VITE_SUPABASE_* estão presentes antes de renderizar o app.
 */

import React, { useEffect, useRef, useState } from 'react';
import { showFatalError, setSupabaseInfraFatal } from '../lib/supabaseInfraGuard';
import { validateSupabaseUrl } from '../lib/validateSupabaseUrl';
import { assertEnv } from '../lib/assertEnv';
import { checkSupabaseConnection } from '../services/checkSupabaseConnection';
import { sanitizeAuthSessionOnBoot } from '../../services/supabase';
import { getSchemaGuardError } from '@/services/schemaGuard';
import { readAuditLogsTenantIdFromEnv } from '@/services/schemaColumnDetection';
import { reportSchemaGuardState } from '@/services/schemaGuardReporter';
import { getCurrentEngineVersion, getCurrentRulesVersion } from '@/services/timesheetCalculationAudit';
import { installMobileRuntimeStability } from '../performance/mobileRuntimeStability';
import { messageFromUnknown } from '@/utils/messageFromUnknown';
import { devVerboseInfo, isDevVerboseLogsEnabled } from '@/utils/devVerboseLogs';
import { getSupabaseClient } from '../lib/supabaseClient';

interface AppInitializerProps {
  children: React.ReactNode;
}

export const AppInitializer: React.FC<AppInitializerProps> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initStartedRef = useRef(false);

  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    let mounted = true;
    const init = async () => {
      let supabaseUrl = '';
      let supabaseKey = '';
      try {
        const env = assertEnv();
        supabaseUrl = env.url;
        supabaseKey = env.key;
      } catch (error: unknown) {
        const message = messageFromUnknown(
          error,
          'Variáveis VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não carregadas',
        );
        setSupabaseInfraFatal(message);
        if (mounted) setError(message);
        return;
      }

      console.log('SUPABASE URL:', supabaseUrl);

      if (typeof console !== 'undefined' && isDevVerboseLogsEnabled()) {
        console.group('[ENV]');
        console.log('Mode:', import.meta.env.MODE);
        console.log('URL:', supabaseUrl);
        console.log('Anon key length:', supabaseKey.length);
        console.log('Online:', typeof navigator === 'undefined' ? true : navigator.onLine);
        console.groupEnd();
      }

      readAuditLogsTenantIdFromEnv();
      const schemaError = getSchemaGuardError();
      if (schemaError) {
        void reportSchemaGuardState({
          mode: schemaError.mode,
          env: schemaError.env,
          timestamp: schemaError.timestamp,
          message: schemaError.message,
          correlation_id: schemaError.correlation_id,
          origin: 'AppInitializer',
        });
        if (schemaError.mode === 'production-error') {
          console.error('[APP INIT] Schema Guard CRÍTICO:', schemaError);
        } else {
          console.warn('[APP INIT] Schema Guard (dev):', schemaError);
        }
      }

      if (!validateSupabaseUrl(supabaseUrl)) {
        const message = 'VITE_SUPABASE_URL inválida (deve ser https://*.supabase.co)';
        setSupabaseInfraFatal(message);
        showFatalError(message);
        if (mounted) setError(message);
        return;
      }

      if (typeof window !== 'undefined') {
        window.__SUPABASE_OFFLINE_DEV = false;
      }

      const engineVer = getCurrentEngineVersion();
      const rulesVer = getCurrentRulesVersion();
      devVerboseInfo('[APP VERSION]', { ENGINE_VERSION: engineVer, RULES_VERSION: rulesVer });
      try {
        const versionStorageKey = 'pontowebdesk:last-engine-rules-version';
        const nextPayload = JSON.stringify({ engine: engineVer, rules: rulesVer });
        const prevRaw =
          typeof localStorage !== 'undefined' ? localStorage.getItem(versionStorageKey) : null;
        if (prevRaw && prevRaw !== nextPayload && typeof console !== 'undefined') {
          try {
            console.warn('[VERSION CHANGE DETECTED]', {
              previous: JSON.parse(prevRaw) as { engine?: string; rules?: string },
              current: { engine: engineVer, rules: rulesVer },
            });
          } catch {
            console.warn('[VERSION CHANGE DETECTED]', { rawPrevious: prevRaw, current: nextPayload });
          }
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(versionStorageKey, nextPayload);
        }
      } catch {
        /* quota / modo privado */
      }

      if (typeof window !== 'undefined') {
        installMobileRuntimeStability();
      }

      await sanitizeAuthSessionOnBoot();

      // Força criação do cliente (valida init + log no console)
      getSupabaseClient();

      if (mounted) setIsReady(true);

      void checkSupabaseConnection();
    };

    void init();

    return () => {
      mounted = false;
    };
  }, []);

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#f3f4f6',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            padding: '2rem',
            backgroundColor: 'white',
            borderRadius: '0.5rem',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            maxWidth: '500px',
          }}
        >
          <h1 style={{ color: '#dc2626', marginBottom: '1rem' }}>❌ Erro de Configuração</h1>
          <p style={{ color: '#666', marginBottom: '1rem' }}>{error}</p>
          <p style={{ color: '#999', fontSize: '0.875rem' }}>
            Verifique o console do navegador (F12) para mais detalhes.
          </p>
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#f3f4f6',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            padding: '2rem',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              border: '4px solid #e5e7eb',
              borderTop: '4px solid #4f46e5',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 1rem',
            }}
          />
          <p style={{ color: '#666' }}>Carregando configuração...</p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
