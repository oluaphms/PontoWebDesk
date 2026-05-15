import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { initSentry } from './lib/sentry';
import { ThemeService } from './services/themeService';
import { i18n } from './lib/i18n';
import App from './App';
import { ToastProvider } from './src/components/ToastProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { LanguageProvider } from './src/contexts/LanguageContext';
import { AppInitializer } from './src/components/AppInitializer';
import { startLongTaskMonitor } from './src/performance/longTaskMonitor';
import { focusManager } from '@tanstack/react-query';
import { isPostLoginQueryCooldownActive } from './src/app/postLoginQueryGate';

try {
  initSentry();
} catch (e) {
  console.warn('[Sentry] init falhou (ignorado no dev):', e);
}

// Após deploy, chunks antigos podem 404; um reload recupera. Evita loop com sessionStorage.
const CHUNK_RELOAD_FLAG = '__cd_chunk_reload_once';
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
        !/Failed to fetch dynamically imported module|Loading chunk \d+ failed|Importing a module script failed/i.test(
          msg
        )
      ) {
        return;
      }
      if (sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1') {
        sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
        return;
      }
      sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
      event.preventDefault();
      window.location.reload();
    },
    { passive: false }
  );
  window.addEventListener('load', function () {
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
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
          if (import.meta.env.DEV && typeof console !== 'undefined') {
            console.info('[QUERY WINDOW FOCUS REFETCH SUPPRESSED]', { reason: 'post_login_cooldown' });
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
    <AppInitializer>
      <BrowserRouter>
        <LanguageProvider>
          <ToastProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </ToastProvider>
        </LanguageProvider>
      </BrowserRouter>
    </AppInitializer>
  </StrictMode>
);