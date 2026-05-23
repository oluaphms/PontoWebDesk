/**
 * Boot não bloqueante: UI sempre carrega; dados via API VPS.
 */

import React, { useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../services/api';
import { apiGet } from '../services/api';
import { getSchemaGuardError } from '@/services/schemaGuard';
import { readAuditLogsTenantIdFromEnv } from '@/services/schemaColumnDetection';
import { reportSchemaGuardState } from '@/services/schemaGuardReporter';
import { getCurrentEngineVersion, getCurrentRulesVersion } from '@/services/timesheetCalculationAudit';
import { installMobileRuntimeStability } from '../performance/mobileRuntimeStability';
import { devVerboseInfo, isDevVerboseLogsEnabled } from '@/utils/devVerboseLogs';

interface AppInitializerProps {
  children: React.ReactNode;
}

export const AppInitializer: React.FC<AppInitializerProps> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);
  const initStartedRef = useRef(false);

  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    let mounted = true;
    const init = async () => {
      const apiUrl = getApiBaseUrl();
      if (isDevVerboseLogsEnabled()) {
        console.group('[ENV]');
        console.log('API URL:', apiUrl);
        console.log('Mode:', import.meta.env.MODE);
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

      try {
        await apiGet('/health');
      } catch (e) {
        console.warn('[APP INIT] API health check falhou (não bloqueia UI):', e);
      }

      if (mounted) setIsReady(true);
    };

    void init();

    return () => {
      mounted = false;
    };
  }, []);

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
        <div style={{ textAlign: 'center', padding: '2rem' }}>
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
          <p style={{ color: '#666' }}>Carregando…</p>
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
