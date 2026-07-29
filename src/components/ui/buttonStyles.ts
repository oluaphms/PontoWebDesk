/**
 * Botões do Design System — pesos visuais distintos no light e dark.
 * Roxo/indigo preservado como marca (primary).
 */
export const buttonStyles = {
  base:
    'inline-flex h-9 min-h-9 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  primary:
    'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 hover:shadow-md active:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:text-slate-950',
  secondary:
    'bg-slate-100 text-slate-800 border border-slate-200/90 shadow-sm hover:bg-slate-200/90 hover:border-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-700',
  outline:
    'bg-white text-slate-700 border border-slate-300 shadow-sm hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 dark:bg-transparent dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-800',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
  danger:
    'bg-red-600 text-white shadow-sm hover:bg-red-700 hover:shadow-md active:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500',
  success:
    'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 hover:shadow-md active:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500',
  loading: 'opacity-70 cursor-wait pointer-events-none',
} as const;
