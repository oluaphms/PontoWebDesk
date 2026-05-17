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
import { useNavigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import type { HelpErrorCode } from '../help/helpErrorMap';
import { HELP_ERROR_MAP, detectHelpErrorCode } from '../help/helpErrorMap';
import { openHelpFromError } from '../help/openHelp';
import { emitHelpErrorFromMessage } from '../help/helpErrorBridge';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  helpErrorCode?: HelpErrorCode;
}

export interface ToastOptions {
  helpErrorCode?: HelpErrorCode;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string, options?: ToastOptions) => void;
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
    [],
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

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const navigate = useNavigate();
  const helpCode = toast.helpErrorCode ?? detectHelpErrorCode(toast.message);
  const helpEntry = helpCode ? HELP_ERROR_MAP[helpCode] : null;

  return (
    <div
      className={`px-4 py-3 rounded-2xl shadow-lg text-sm font-medium text-white max-w-sm ${
        toast.type === 'success'
          ? 'bg-emerald-600'
          : toast.type === 'error'
            ? 'bg-red-600'
            : toast.type === 'warning'
              ? 'bg-amber-600'
              : 'bg-slate-800'
      }`}
    >
      <p>{typeof toast.message === 'string' ? toast.message : String(toast.message)}</p>
      {helpCode && helpEntry && (
        <button
          type="button"
          onClick={() => {
            openHelpFromError(helpCode, navigate);
            onDismiss(toast.id);
          }}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold underline underline-offset-2 text-white/95 hover:text-white"
        >
          <BookOpen size={14} />
          Ver como resolver
        </button>
      )}
    </div>
  );
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

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timeoutsRef.current[id]) {
      window.clearTimeout(timeoutsRef.current[id]);
      delete timeoutsRef.current[id];
    }
  }, []);

  const addToast = useCallback((type: ToastType, message: string, options?: ToastOptions) => {
    const detected = options?.helpErrorCode ?? detectHelpErrorCode(message) ?? undefined;
    if (type === 'error' && detected) {
      emitHelpErrorFromMessage(message);
    }

    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, message, helpErrorCode: detected }]);
    const timeoutId = window.setTimeout(() => dismissToast(id), detected ? 8000 : 4000);
    timeoutsRef.current[id] = timeoutId;
  }, [dismissToast]);

  const value = useMemo<ToastContextValue>(() => ({ addToast }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 bottom-4 z-[140] space-y-2 max-w-sm">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
