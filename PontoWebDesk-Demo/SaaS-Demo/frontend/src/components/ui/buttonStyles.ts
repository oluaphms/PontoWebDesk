/**
 * Botões do Design System — pesos visuais distintos no light e dark.
 * Roxo/indigo preservado como marca (primary).
 */
export const buttonStyles = {
  base:
    'inline-flex h-9 min-h-9 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[var(--ds-canvas)] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  primary:
    'bg-indigo-600 text-white border border-indigo-500/40 shadow-sm hover:bg-indigo-700 hover:shadow-md active:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:text-slate-950 dark:border-indigo-300/30 dark:shadow-card',
  secondary:
    'bg-slate-100 text-slate-800 border border-slate-200/90 shadow-sm hover:bg-slate-200/90 hover:border-slate-300 dark:bg-surface-2 dark:text-foreground dark:border-border-strong dark:hover:bg-surface-3 dark:shadow-card',
  outline:
    'bg-white text-slate-700 border border-slate-300 shadow-sm hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 dark:bg-surface-sunken dark:text-foreground-secondary dark:border-border-strong dark:hover:bg-surface-2 dark:hover:text-foreground dark:shadow-card',
  ghost:
    'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 hover:text-slate-900 dark:text-foreground-muted dark:hover:bg-hover dark:hover:text-foreground dark:hover:border-border',
  danger:
    'bg-red-600 text-white border border-red-500/40 shadow-sm hover:bg-red-700 hover:shadow-md active:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500 dark:border-red-400/35 dark:shadow-card',
  success:
    'bg-emerald-600 text-white border border-emerald-500/40 shadow-sm hover:bg-emerald-700 hover:shadow-md active:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:border-emerald-400/35 dark:shadow-card',
  loading: 'opacity-70 cursor-wait pointer-events-none',
} as const;
