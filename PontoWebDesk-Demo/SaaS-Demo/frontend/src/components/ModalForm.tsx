import React, { ReactNode } from 'react';

interface ModalFormProps {
  title: string;
  description?: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: ReactNode;
  footer?: ReactNode;
}

export const ModalForm: React.FC<ModalFormProps> = ({
  title,
  description,
  isOpen,
  onClose,
  onSubmit,
  children,
  footer,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-md" role="dialog" aria-modal="true">
      <div className="w-full max-w-[min(100vw,42rem)] lg:max-w-7xl max-h-[92dvh] sm:max-h-[90vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-[2.5rem] shadow-2xl border border-slate-900/10 dark:border-slate-800 overflow-y-auto overflow-x-hidden flex flex-col sm:my-auto min-h-0">
        <header className="px-4 sm:px-8 py-4 sm:py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 min-w-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white break-words">{title}</h2>
            {description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-words">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl p-2"
          >
            ×
          </button>
        </header>

        <form onSubmit={onSubmit} className="px-4 sm:px-8 py-4 sm:py-6 space-y-6 min-w-0">
          {children}
          {footer && <div className="pt-2 border-t border-slate-100 dark:border-slate-800">{footer}</div>}
        </form>
      </div>
    </div>
  );
};

export default ModalForm;

