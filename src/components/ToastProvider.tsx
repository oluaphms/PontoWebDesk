import React, { createContext, useContext, ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

interface ToastProviderProps {
  children: ReactNode;
}

interface ToastProviderState {
  toasts: Toast[];
}

/**
 * Versão baseada em classe para evitar problemas de hooks em ambientes
 * com múltiplas cópias de React. Não usa useState/useEffect.
 */
export class ToastProvider extends React.Component<ToastProviderProps, ToastProviderState> {
  private timeouts: Record<string, number> = {};

  constructor(props: ToastProviderProps) {
    super(props);
    this.state = { toasts: [] };
  }

  componentWillUnmount(): void {
    Object.values(this.timeouts).forEach((id) => {
      window.clearTimeout(id);
    });
    this.timeouts = {};
  }

  private addToast: ToastContextValue['addToast'] = (type, message) => {
    const id = crypto.randomUUID();
    this.setState((prev) => ({ toasts: [...prev.toasts, { id, type, message }] }));
    const timeoutId = window.setTimeout(() => {
      this.setState((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) }));
      delete this.timeouts[id];
    }, 4000);
    this.timeouts[id] = timeoutId;
  };

  render() {
    const value: ToastContextValue = { addToast: this.addToast };
    const { children } = this.props;
    const { toasts } = this.state;

    return (
      <ToastContext.Provider value={value}>
        {children}
        <div className="fixed right-4 bottom-4 z-[140] space-y-2 max-w-sm">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-4 py-3 rounded-2xl shadow-lg text-sm font-medium text-white ${
                toast.type === 'success'
                  ? 'bg-emerald-600'
                  : toast.type === 'error'
                  ? 'bg-red-600'
                  : 'bg-slate-800'
              }`}
            >
              {typeof toast.message === 'string' ? toast.message : String(toast.message)}
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    );
  }
}

export default ToastProvider;

