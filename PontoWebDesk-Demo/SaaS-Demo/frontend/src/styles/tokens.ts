/**
 * Design System tokens — classes Tailwind reutilizáveis.
 * Cores semânticas vêm de CSS vars (--ds-*) definidas em index.css.
 * Escala de espaço: 4 / 8 / 12 / 16 / 24 / 32.
 */
export const uiTokens = {
  radius: {
    card: 'rounded-2xl',
    button: 'rounded-xl',
    input: 'rounded-lg',
    badge: 'rounded-full',
    lg: 'rounded-2xl',
    md: 'rounded-xl',
    sm: 'rounded-lg',
  },
  spacing: {
    cardPadding: 'px-6 py-5',
    sectionGap: 'space-y-6',
    internalGap: 'gap-3',
    stackTight: 'space-y-2',
    stack: 'space-y-4',
    stackLoose: 'space-y-8',
    lg: 'px-6 py-5',
    md: 'px-5 py-4',
    sm: 'px-4 py-3',
  },
  typography: {
    pageTitle: 'text-2xl font-semibold tracking-tight text-foreground',
    title: 'text-xl font-semibold text-foreground',
    sectionTitle: 'text-base font-semibold text-foreground',
    subtitle: 'text-sm font-medium text-foreground-secondary',
    body: 'text-sm text-foreground-secondary',
    label: 'text-xs font-semibold uppercase tracking-wide text-foreground-muted',
    helper: 'text-xs text-foreground-muted',
    disabled: 'text-sm text-foreground-disabled',
  },
  surface: {
    canvas: 'bg-canvas text-foreground',
    card: 'bg-surface border border-border shadow-card rounded-2xl transition-colors duration-150',
    cardRaised: 'bg-surface-raised border border-border-strong shadow-elevated rounded-2xl transition-colors duration-150',
    muted: 'bg-surface-muted border border-border',
    sunken: 'bg-surface-sunken',
    sidebar: 'bg-[var(--ds-sidebar)] border-r border-border shadow-card',
  },
  shadow: {
    card: 'shadow-card',
    elevated: 'shadow-elevated',
    hover: 'hover:shadow-elevated',
    sm: 'shadow-sm',
    md: 'shadow-md',
  },
  transition: {
    default: 'transition-all duration-200 ease-in-out',
    colors: 'transition-colors duration-150 ease-in-out',
    transform: 'transition-transform duration-150 ease-out',
  },
  input:
    'w-full rounded-lg border border-border-strong bg-[var(--ds-input)] px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-disabled shadow-sm hover:bg-[var(--ds-input-hover)] hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-brand focus:border-primary disabled:opacity-55 disabled:cursor-not-allowed disabled:bg-surface-muted',
  inputError: 'border-red-400 focus:ring-red-200 focus:border-red-500',
  inputSuccess: 'border-emerald-400 focus:ring-emerald-200 focus:border-emerald-500',
  table: {
    wrap: 'ds-table-wrap overflow-auto',
    base: 'ds-table w-full text-sm text-left',
    head: 'sticky top-0 z-[1]',
    headerCell:
      'px-3.5 py-3 text-xs font-semibold uppercase tracking-wide text-foreground-secondary',
    row: 'border-b border-border transition-colors duration-150',
    cell: 'px-3.5 py-3 text-foreground-secondary',
    cellPrimary: 'px-3.5 py-3 font-medium text-foreground',
  },
  badge: {
    base: 'ds-badge',
    success: 'ds-badge ds-badge-success',
    warning: 'ds-badge ds-badge-warning',
    danger: 'ds-badge ds-badge-danger',
    info: 'ds-badge ds-badge-info',
    neutral: 'ds-badge ds-badge-neutral',
    processing: 'ds-badge ds-badge-processing',
  },
} as const;

export const repUiPatterns = {
  card: `${uiTokens.radius.lg} ${uiTokens.spacing.lg} ${uiTokens.shadow.card} border border-border bg-surface`,
  modal: `${uiTokens.radius.lg} ${uiTokens.spacing.lg} ${uiTokens.shadow.elevated}`,
  section: `${uiTokens.spacing.sectionGap}`,
} as const;
