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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4">
      <div className="w-full max-w-xl max-h-[90vh] sm:max-h-[80vh] bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-y-auto">
        <header className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
            {description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{description}</p>
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

        <form onSubmit={onSubmit} className="px-8 py-6 space-y-6">
          {children}
          {footer && <div className="pt-2 border-t border-slate-100 dark:border-slate-800">{footer}</div>}
        </form>
      </div>
    </div>
  );
};

export default ModalForm;

