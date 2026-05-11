import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  const fallback = useMemo(
    () => ({
      addToast: (type: ToastType, message: string) => {
        const log = type === 'error' ? console.error : type === 'success' ? console.info : console.log;
        log.call(console, `[Toast ${type}]`, message);
      },
    }),
    []
  );
  if (ctx) return ctx;
  if (import.meta.env?.DEV) {
    console.warn('[useToast] Nenhum ToastProvider encontrado — mensagens vão para o console.');
  }
  return fallback;
};

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      Object.values(timeoutsRef.current).forEach((id: number) => window.clearTimeout(id));
      timeoutsRef.current = {};
    };
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, message }]);
    const timeoutId = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      delete timeoutsRef.current[id];
    }, 4000);
    timeoutsRef.current[id] = timeoutId;
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ addToast }), [addToast]);

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
                  : toast.type === 'warning'
                    ? 'bg-amber-600'
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

export default ToastProvider;
