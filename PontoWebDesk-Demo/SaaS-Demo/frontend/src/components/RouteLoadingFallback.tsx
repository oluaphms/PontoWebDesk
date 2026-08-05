import React, { useEffect, useState } from 'react';
import { Button, LoadingState } from '../../components/UI';

interface RouteLoadingFallbackProps {
  message?: string;
  timeoutMs?: number;
  onRetry?: () => void;
  onReload?: () => void;
}

const DEFAULT_TIMEOUT_MS = 15000;

const RouteLoadingFallback: React.FC<RouteLoadingFallbackProps> = ({
  message = 'Carregando página...',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onRetry,
  onReload,
}) => {
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowRetry(true);
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [timeoutMs]);

  if (!showRetry) {
    return <LoadingState message={message} />;
  }

  return (
    <div className="flex flex-col items-center justify-center p-10 text-center space-y-4">
      <LoadingState message="Ainda estamos carregando..." />
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 max-w-sm">
        A navegação está demorando mais que o esperado. Você pode tentar novamente sem sair da tela ou recarregar a página.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        {onRetry && (
          <Button onClick={onRetry} variant="outline" size="md">
            Tentar novamente
          </Button>
        )}
        <Button onClick={onReload || (() => window.location.reload())} size="md">
          Recarregar página
        </Button>
      </div>
    </div>
  );
};

export default RouteLoadingFallback;
