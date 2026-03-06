import React, { memo, useEffect } from 'react';
import { X } from 'lucide-react';

export interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  'aria-label'?: string;
}

const MobileDrawer: React.FC<MobileDrawerProps> = ({
  open,
  onClose,
  children,
  'aria-label': ariaLabel = 'Menu de navegação',
}) => {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] lg:hidden animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => e.key === 'Enter' && onClose()}
        aria-hidden="true"
      />
      <aside
        className="absolute left-0 top-0 bottom-0 w-[280px] max-w-[85vw] bg-white dark:bg-slate-900 shadow-2xl flex flex-col animate-in slide-in-from-left duration-300"
        style={{ boxShadow: '4px 0 24px rgba(0,0,0,0.15)' }}
      >
        <div className="flex items-center justify-end p-4 border-b border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Fechar menu"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
};

export default memo(MobileDrawer);
