/**
 * Error Boundary — usa `react-error-boundary` (API funcional) sobre o boundary nativo do React.
 * Captura erros na árvore, envia ao Sentry e exibe fallback.
 */

import React, { ErrorInfo, ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from './UI';
import { captureException } from '../lib/sentry';
import {
  attemptChunkAutoRecover,
  clearChunkRecoverFlags,
  isLikelyChunkLoadFailure,
} from '../src/utils/chunkLoadRecovery';

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Lazy route falhou porque o servidor Vite já não está a responder (ERR_CONNECTION_REFUSED / HMR perdido). */
function isLikelyViteDevServerGone(error: unknown): boolean {
  const raw = `${error instanceof Error ? error.message : String(error)}\n${error instanceof Error && error.stack ? error.stack : ''}`;
  const lower = raw.toLowerCase();
  return (
    lower.includes('failed to fetch dynamically imported module') ||
    lower.includes('net::err_connection_refused') ||
    (lower.includes('localhost') && lower.includes('failed to fetch') && lower.includes('.tsx'))
  );
}

function isDevUiEnv(): boolean {
  return (
    (typeof import.meta !== 'undefined' && !!import.meta.env?.DEV) ||
    (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  );
}

function DefaultFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  const err = toError(error);
  const isDevUi = isDevUiEnv();
  const deadViteHint = isDevUi && isLikelyViteDevServerGone(err);
  const chunkStale = isLikelyChunkLoadFailure(err);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full glass-card rounded-[3rem] p-10 md:p-14 space-y-8">
        <div className="flex items-center justify-center">
          <div className="w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
            <AlertTriangle size={40} className="text-red-600 dark:text-red-400" />
          </div>
        </div>

        <div className="text-center space-y-4">
          <h1 className="text-3xl font-black text-slate-900 dark:text-white">Ops! Algo deu errado</h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            {chunkStale
              ? 'Uma atualização do sistema ficou pendente no navegador. Recarregue a página para continuar.'
              : 'Ocorreu um erro inesperado. Nossa equipe foi notificada.'}
          </p>
        </div>

        {chunkStale && !deadViteHint && (
          <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 p-5 text-left">
            <p className="text-sm text-indigo-900 dark:text-indigo-100 leading-relaxed">
              Isso costuma acontecer após um deploy ou com a aba aberta há muito tempo. O atalho{' '}
              <strong>F5</strong> ou o botão abaixo costuma resolver sem perder a sessão.
            </p>
          </div>
        )}

        {deadViteHint && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-5 text-left space-y-2">
            <p className="font-bold text-amber-900 dark:text-amber-200 text-sm">
              Provável causa (ambiente de desenvolvimento)
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-100/90 leading-relaxed">
              O servidor Vite em <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-1 rounded">localhost:3010</code>{' '}
              deixou de responder (processo terminou ou conexão HMR perdida). O pedido falhou ao carregar uma página lazy
              (ex.: Employees). Reinicia o comando <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-1 rounded">npm run dev</code> no terminal,
              espera ficar estável e recarrega a página — o login em si pode já ter corrido bem.
            </p>
          </div>
        )}

        {isDevUi && (
          <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">
              Detalhes do Erro (ambiente local / dev):
            </h3>
            <pre className="text-xs text-red-600 dark:text-red-400 overflow-auto max-h-64 custom-scrollbar whitespace-pre-wrap break-words">
              {err.toString()}
              {err.stack ? `\n\n${err.stack}` : ''}
            </pre>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            onClick={resetErrorBoundary}
            variant="outline"
            size="lg"
            className="flex items-center gap-2"
          >
            <RefreshCw size={18} />
            Tentar Novamente
          </Button>
          <Button onClick={() => window.location.reload()} size="lg" className="flex items-center gap-2">
            <Home size={18} />
            Recarregar Página
          </Button>
        </div>

        <div className="text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Se o problema persistir, entre em contato com o suporte.
          </p>
        </div>
      </div>
    </div>
  );
}

function useBoundaryResetKeys(): string[] {
  const location = useLocation();
  return [location.pathname, location.search];
}

function useClearChunkFlagsOnNavigate(): void {
  const location = useLocation();
  useEffect(() => {
    clearChunkRecoverFlags();
  }, [location.pathname, location.search]);
}

function handleBoundaryError(error: unknown, info: ErrorInfo): void {
  const err = toError(error);
  console.error('ErrorBoundary capturou um erro:', err.message, err.stack, info);
  captureException(err, { react: { componentStack: info.componentStack } });

  if (isLikelyChunkLoadFailure(err)) {
    attemptChunkAutoRecover();
  }
}

export default function AppErrorBoundary({ children, fallback }: AppErrorBoundaryProps) {
  const resetKeys = useBoundaryResetKeys();
  useClearChunkFlagsOnNavigate();

  if (fallback) {
    return (
      <ErrorBoundary fallback={fallback} onError={handleBoundaryError} resetKeys={resetKeys}>
        {children}
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary
      FallbackComponent={DefaultFallback}
      onError={handleBoundaryError}
      resetKeys={resetKeys}
    >
      {children}
    </ErrorBoundary>
  );
}

/** Error boundary na raiz — deve ficar dentro de BrowserRouter. */
export function RootErrorBoundary({ children }: { children: ReactNode }) {
  const resetKeys = useBoundaryResetKeys();
  useClearChunkFlagsOnNavigate();

  return (
    <ErrorBoundary
      FallbackComponent={DefaultFallback}
      onError={handleBoundaryError}
      resetKeys={resetKeys}
    >
      {children}
    </ErrorBoundary>
  );
}
