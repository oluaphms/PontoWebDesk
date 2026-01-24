/**
 * Error Boundary Component
 * 
 * Captura erros React e exibe uma UI de fallback
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from './UI';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary capturou um erro:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo
    });

    // Aqui você poderia enviar o erro para um serviço de logging
    // Ex: Sentry.captureException(error, { contexts: { react: errorInfo } });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-6">
          <div className="max-w-2xl w-full glass-card rounded-[3rem] p-10 md:p-14 space-y-8">
            <div className="flex items-center justify-center">
              <div className="w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
                <AlertTriangle size={40} className="text-red-600 dark:text-red-400" />
              </div>
            </div>

            <div className="text-center space-y-4">
              <h1 className="text-3xl font-black text-slate-900 dark:text-white">
                Ops! Algo deu errado
              </h1>
              <p className="text-slate-600 dark:text-slate-400 text-lg">
                Ocorreu um erro inesperado. Nossa equipe foi notificada.
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-6 space-y-4">
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  Detalhes do Erro (Desenvolvimento):
                </h3>
                <pre className="text-xs text-red-600 dark:text-red-400 overflow-auto max-h-64 custom-scrollbar">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                onClick={this.handleReset}
                variant="outline"
                size="lg"
                className="flex items-center gap-2"
              >
                <RefreshCw size={18} />
                Tentar Novamente
              </Button>
              <Button
                onClick={this.handleReload}
                size="lg"
                className="flex items-center gap-2"
              >
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

    return this.props.children;
  }
}

export default ErrorBoundary;
