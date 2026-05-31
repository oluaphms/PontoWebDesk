import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import { useEffect, useRef, useState } from 'react';
import { getSchemaGuardError } from '@/services/schemaGuard';
import { safeJsonStringify } from '@/services/schemaGuardReporter';

const IS_PRODUCTION = import.meta.env.MODE === 'production';

export default function SchemaGuardBadge() {
  const [state, setState] = useState<any>(null);
  const [justCleared, setJustCleared] = useState(false);
  const [justExported, setJustExported] = useState(false);
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdExportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const altShiftDActiveRef = useRef(false);

  const copySchemaGuardReport = () => {
    if (typeof window === 'undefined') return;
    const report = {
      mode: state?.mode ?? null,
      env: state?.env ?? null,
      correlation_id: state?.correlation_id ?? null,
      timestamp: state?.timestamp ?? null,
      url: window.location.href,
      userAgent: navigator.userAgent,
    };
    try {
      const payload = JSON.stringify(report, null, 2);
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(payload);
      }
      observabilityConsole.info('[SCHEMA GUARD DEBUG] relatório copiado para suporte');
    } catch {
      observabilityConsole.info('[SCHEMA GUARD DEBUG] relatório copiado para suporte');
    }
  };

  const downloadSchemaGuardReport = () => {
    try {
      if (typeof window === 'undefined') return;
      if (IS_PRODUCTION && !(window as any).__SCHEMA_GUARD_DEBUG__) return;
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
        now.getHours(),
      )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const appVersion = import.meta.env.VITE_APP_VERSION || 'dev';
      const sessionId = (window as any).__SCHEMA_SESSION_ID__ || crypto.randomUUID();
      (window as any).__SCHEMA_SESSION_ID__ = sessionId;
      const payload = {
        mode: state?.mode ?? null,
        env: state?.env ?? null,
        correlation_id: state?.correlation_id ?? null,
        session_id: sessionId ?? null,
        timestamp: state?.timestamp ?? null,
        app_version: appVersion,
        url: window.location.href,
        userAgent: navigator.userAgent,
        state: (window as any).__SCHEMA_GUARD_ERROR__ || null,
      };
      const serialized = safeJsonStringify(payload);
      const json = serialized === '[unserializable]' ? JSON.stringify({ error: serialized }) : serialized;
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `schema-guard-report-${ts}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      observabilityConsole.log('[SCHEMA GUARD DEBUG] relatório exportado (.json)');
      setJustExported(true);
      if (exportTimeoutRef.current) {
        clearTimeout(exportTimeoutRef.current);
      }
      exportTimeoutRef.current = setTimeout(() => setJustExported(false), 1500);
    } catch (error) {
      observabilityConsole.error('[SCHEMA GUARD DEBUG] erro ao exportar relatório', error);
    }
  };

  useEffect(() => {
    if (IS_PRODUCTION || typeof window === 'undefined') return;

    const handler = (event: any) => {
      setState(event.detail);
      if (!event.detail) {
        setJustCleared(true);
        if (clearTimeoutRef.current) {
          clearTimeout(clearTimeoutRef.current);
        }
        clearTimeoutRef.current = setTimeout(() => setJustCleared(false), 1500);
      }
    };

    const initial = getSchemaGuardError();
    setState(initial);

    window.addEventListener('schema-guard:update', handler);

    return () => {
      window.removeEventListener('schema-guard:update', handler);
      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current);
        clearTimeoutRef.current = null;
      }
      if (holdExportTimeoutRef.current) {
        clearTimeout(holdExportTimeoutRef.current);
        holdExportTimeoutRef.current = null;
      }
      if (exportTimeoutRef.current) {
        clearTimeout(exportTimeoutRef.current);
        exportTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (IS_PRODUCTION || typeof window === 'undefined') return;
    const toggle = (e: KeyboardEvent) => {
      if (e.key === 'g' && e.ctrlKey) {
        setState((prev: any) => (prev ? null : getSchemaGuardError()));
      }
      if (e.key === 'r' && e.ctrlKey && e.shiftKey) {
        (window as any).__SCHEMA_GUARD_DEBUG__?.resetAll?.();
        observabilityConsole.info('[SCHEMA GUARD DEBUG] reset completo via atalho');
        return;
      }
      if (e.key === 'r' && e.ctrlKey) {
        (window as any).__SCHEMA_GUARD_DEBUG__?.clear();
      }
      if (e.key.toLowerCase() === 'g' && e.ctrlKey && e.shiftKey) {
        observabilityConsole.warn('[SCHEMA GUARD DEBUG]', getSchemaGuardError());
      }
      if (e.key.toLowerCase() === 'd' && e.altKey && e.shiftKey) {
        altShiftDActiveRef.current = true;
        window.setTimeout(() => {
          altShiftDActiveRef.current = false;
        }, 1000);
      }
    };

    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, []);

  const isCritical = state?.mode === 'production-error';

  if (!isCritical && justCleared) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          padding: '6px 10px',
          borderRadius: 8,
          fontSize: 12,
          background: '#52c41a',
          color: '#fff',
          zIndex: 9999,
          animation: 'schemaGuardFade 0.2s ease',
        }}
      >
        ✔ Resetado
        <style>{`
          @keyframes schemaGuardFade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  if (!isCritical && justExported) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          padding: '6px 10px',
          borderRadius: 8,
          fontSize: 12,
          background: '#52c41a',
          color: '#fff',
          zIndex: 9999,
          animation: 'schemaGuardFade 0.2s ease',
        }}
      >
        ✔ Exportado
        <style>{`
          @keyframes schemaGuardFade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  if (IS_PRODUCTION || !state) return null;
  /** Avisos de dev não ocupam ecrã; só falhas críticas (produção ou simulação via debug). */
  if (state.mode !== 'production-error') return null;

  const label = 'Erro crítico';
  const origin = state.origin || 'desconhecida';
  const correlationShort = state.correlation_id ? String(state.correlation_id).slice(0, 8) : '----';
  const tooltip = `Modo: ${label} • Origem: ${origin} • Corr: ${correlationShort} • Clique para ver detalhes`;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9999,
        padding: '8px 12px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        background: '#ff4d4f',
        color: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        cursor: 'pointer',
        animation: 'schemaGuardFade 0.2s ease',
      }}
      onClick={(event) => {
        if (event.altKey && event.shiftKey) {
          if (altShiftDActiveRef.current) {
            downloadSchemaGuardReport();
            return;
          }
          copySchemaGuardReport();
          return;
        }
        observabilityConsole.warn('[SCHEMA GUARD DEBUG]', state);
        if (event.altKey) {
          try {
            const payload = JSON.stringify(state);
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(payload);
            }
            observabilityConsole.info('[SCHEMA GUARD DEBUG] estado copiado');
          } catch {
            observabilityConsole.info('[SCHEMA GUARD DEBUG] estado copiado');
          }
          return;
        }
        if (typeof window !== 'undefined' && (window as any).__SCHEMA_GUARD_DEBUG__) {
          observabilityConsole.info('Use __SCHEMA_GUARD_DEBUG__.clear() para resetar');
        }
      }}
      onMouseDown={(event) => {
        if (event.altKey && !event.shiftKey) {
          if (holdExportTimeoutRef.current) {
            clearTimeout(holdExportTimeoutRef.current);
          }
          holdExportTimeoutRef.current = setTimeout(() => {
            downloadSchemaGuardReport();
          }, 1000);
        }
      }}
      onMouseUp={() => {
        if (holdExportTimeoutRef.current) {
          clearTimeout(holdExportTimeoutRef.current);
          holdExportTimeoutRef.current = null;
        }
      }}
      title={tooltip}
    >
      ⚠ {label} · {correlationShort}
      <style>{`
        @keyframes schemaGuardFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
