import { observabilityConsole } from './src/shared/logger/observabilityConsole';
import React, { StrictMode, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import './index.css';
import { initSentry } from './lib/sentry';
import { ThemeService } from './services/themeService';
import { i18n } from './lib/i18n';
import { ToastProvider } from './src/components/ToastProvider';
import { RootErrorBoundary } from './components/ErrorBoundary';
import { CHUNK_RELOAD_LEGACY_KEY, CHUNK_RELOAD_SESSION_KEY } from './src/utils/chunkLoadRecovery';
import { LanguageProvider } from './src/contexts/LanguageContext';
import { AppInitializer } from './src/components/AppInitializer';
import { startLongTaskMonitor } from './src/performance/longTaskMonitor';
import { focusManager } from '@tanstack/react-query';
import { isPostLoginQueryCooldownActive } from './src/app/postLoginQueryGate';
import { IS_DEV } from './src/config/runtimeEnv';
import { isMasterPath } from './src/master/isMasterPath';

const OperationalApp = React.lazy(() => import('./App'));
const MasterBootstrap = React.lazy(() => import('./src/master/MasterBootstrap'));

function BootFallback({ message }: { message: string }) {
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
      <p style={{ color: '#666' }}>{message}</p>
    </div>
  );
}

/**
 * Escolhe o shell Master vs Operacional conforme o pathname atual.
 * Mantém cold start isolado (lazy) e corrige Links SPA entre os dois mundos.
 * `key` força desmontagem limpa dos providers ao alternar.
 */
function WorldRoot() {
  const { pathname } = useLocation();
  const masterEntry = isMasterPath(pathname);

  return (
    <Suspense
      fallback={
        <BootFallback
          message={masterEntry ? 'Carregando Painel Master...' : 'Carregando...'}
        />
      }
    >
      {masterEntry ? (
        <MasterBootstrap key="world-master" />
      ) : (
        <AppInitializer key="world-operational">
          <OperationalApp />
        </AppInitializer>
      )}
    </Suspense>
  );
}

try {
  initSentry();
} catch (e) {
  observabilityConsole.warn('[Sentry] init falhou (ignorado no dev):', e);
}

// Após deploy, chunks antigos podem 404; um reload recupera. Evita loop com sessionStorage.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'unhandledrejection',
    function (event: PromiseRejectionEvent) {
      const r = event.reason;
      const msg =
        typeof r === 'object' && r !== null && 'message' in r
          ? String((r as Error).message)
          : String(r);
      if (
        !/Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk [\da-f]+ failed|Importing a module script failed|Failed to load module script|ChunkLoadError/i.test(
          msg,
        )
      ) {
        return;
      }
      if (sessionStorage.getItem(CHUNK_RELOAD_LEGACY_KEY) === '1') {
        sessionStorage.removeItem(CHUNK_RELOAD_LEGACY_KEY);
        return;
      }
      if (sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY) === '1') {
        return;
      }
      sessionStorage.setItem(CHUNK_RELOAD_LEGACY_KEY, '1');
      event.preventDefault();
      window.location.reload();
    },
    { passive: false },
  );
  window.addEventListener('load', function () {
    sessionStorage.removeItem(CHUNK_RELOAD_LEGACY_KEY);
    sessionStorage.removeItem(CHUNK_RELOAD_SESSION_KEY);
  });
}

ThemeService.init();
i18n.init();
startLongTaskMonitor();

if (typeof document !== 'undefined') {
  focusManager.setEventListener((handleFocus) => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (isPostLoginQueryCooldownActive()) {
          if (IS_DEV && typeof console !== 'undefined') {
            observabilityConsole.info('[QUERY WINDOW FOCUS REFETCH SUPPRESSED]', { reason: 'post_login_cooldown' });
          }
          return;
        }
        handleFocus();
      }
    };
    document.addEventListener('visibilitychange', onVisibility, false);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');

const envFatalError =
  typeof window !== 'undefined' ? (window as any).__ENV_FATAL_ERROR : null;
if (envFatalError) {
  rootElement.replaceChildren();
  const container = document.createElement('div');
  container.style.padding = '40px';
  container.style.fontFamily = 'system-ui,-apple-system,sans-serif';
  const title = document.createElement('h1');
  title.textContent = 'Erro de configuração';
  const detail = document.createElement('p');
  detail.textContent = String(envFatalError);
  container.appendChild(title);
  container.appendChild(detail);
  rootElement.appendChild(container);
  throw new Error(String(envFatalError));
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <ToastProvider>
          <RootErrorBoundary>
            <WorldRoot />
          </RootErrorBoundary>
        </ToastProvider>
      </LanguageProvider>
    </BrowserRouter>
  </StrictMode>,
);