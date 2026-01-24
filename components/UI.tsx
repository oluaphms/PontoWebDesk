
import React from 'react';
import { AlertCircle, RefreshCcw, SearchX, Loader2, CheckCircle2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  loading?: boolean;
  ariaLabel?: string;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  loading, 
  className = '', 
  ariaLabel,
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center gap-2 font-bold rounded-2xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-4 focus-visible:ring-indigo-500/50";
  
  const variants = {
    primary: "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600",
    secondary: "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200",
    outline: "bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-600 dark:hover:border-indigo-400 shadow-sm",
    ghost: "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800",
    danger: "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
  };

  const sizes = {
    sm: "px-4 py-2 text-xs",
    md: "px-6 py-3 text-sm",
    lg: "px-8 py-5 text-lg",
    xl: "px-8 py-6 text-2xl"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={loading || props.disabled}
      aria-label={ariaLabel}
      aria-busy={loading}
      {...props}
    >
      {loading ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : children}
    </button>
  );
};

export const Badge: React.FC<{ children: React.ReactNode; color?: 'indigo' | 'green' | 'slate' | 'amber' | 'red'; className?: string; role?: string }> = ({ 
  children, 
  color = 'slate',
  className = '',
  role = 'status'
}) => {
  const colors = {
    indigo: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300",
    green: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300",
    slate: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
    amber: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300",
    red: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300"
  };

  return (
    <span 
      role={role}
      className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 ${colors[color]} ${className}`}
    >
      {children}
    </span>
  );
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label?: string; id?: string }> = ({ label, className = '', id, ...props }) => {
  const inputId = id || React.useId();
  return (
    <div className="w-full">
      {label && (
        <label 
          htmlFor={inputId}
          className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3"
        >
          {label}
        </label>
      )}
      <input 
        id={inputId}
        className={`w-full px-5 py-4 bg-slate-50 dark:bg-slate-800 border-2 border-transparent rounded-2xl text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/30 focus:border-indigo-600 dark:focus:border-indigo-500 transition-all ${className}`}
        {...props}
      />
    </div>
  );
};

export const LoadingState: React.FC<{ message?: string }> = ({ message = 'Carregando informações...' }) => (
  <div 
    className="flex flex-col items-center justify-center p-12 text-center animate-in fade-in duration-500"
    role="alert"
    aria-live="polite"
  >
    <div className="relative mb-6">
      <div className="w-16 h-16 border-4 border-indigo-100 dark:border-slate-800 rounded-full"></div>
      <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
    </div>
    <p className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{message}</p>
  </div>
);

export const ErrorState: React.FC<{ title?: string; message: string; onRetry?: () => void }> = ({ 
  title = "Ocorreu um erro", 
  message, 
  onRetry 
}) => (
  <div 
    className="glass-card rounded-[2.5rem] p-10 flex flex-col items-center text-center max-w-md mx-auto animate-in zoom-in-95 duration-300"
    role="alert"
  >
    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 text-red-600 rounded-2xl flex items-center justify-center mb-6">
      <AlertCircle size={32} aria-hidden="true" />
    </div>
    <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">{title}</h3>
    <p className="text-sm text-slate-600 dark:text-slate-400 mb-8 leading-relaxed font-medium">{message}</p>
    {onRetry && (
      <Button onClick={onRetry} variant="outline" size="md">
        <RefreshCcw size={16} aria-hidden="true" /> Tentar Novamente
      </Button>
    )}
  </div>
);

export const EmptyState: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center opacity-70">
    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-2xl flex items-center justify-center mb-6">
      <SearchX size={32} aria-hidden="true" />
    </div>
    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">{title}</h3>
    <p className="text-xs text-slate-600 dark:text-slate-400 font-medium max-w-[240px] leading-relaxed">{message}</p>
  </div>
);

export const SuccessOverlay: React.FC<{ title: string; message: string; visible: boolean }> = ({ title, message, visible }) => (
  <div 
    className={`fixed inset-0 z-[150] pointer-events-none flex items-center justify-center transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 scale-95'}`}
    aria-live="assertive"
    role="status"
  >
    {visible && (
      <div className="bg-white dark:bg-slate-900 px-10 py-8 rounded-[3rem] shadow-2xl flex flex-col items-center gap-4 border-2 border-green-200 dark:border-green-900/50">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
          <CheckCircle2 size={32} className="text-green-600 dark:text-green-500" />
        </div>
        <h4 className="text-xl font-black text-slate-900 dark:text-white">{title}</h4>
        <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">{message}</p>
      </div>
    )}
  </div>
);
