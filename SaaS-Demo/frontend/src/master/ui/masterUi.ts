/**
 * Design System do Painel Master — mesmo padrão visual do operacional.
 * Reexporta tokens/botões compartilhados; não inventa paleta própria.
 */
import { buttonStyles } from '../../components/ui/buttonStyles';
import { cx } from '../../styles/cx';
import { uiTokens } from '../../styles/tokens';

export const masterUi = {
  /** Container de página — espelha o main do Layout operacional */
  page: 'mx-auto w-full max-w-7xl space-y-6',
  pageNarrow: 'mx-auto w-full max-w-5xl space-y-6',
  pageWide: 'mx-auto w-full max-w-7xl space-y-6',

  canvas: uiTokens.surface.canvas,
  card: cx(uiTokens.surface.card, uiTokens.spacing.cardPadding, uiTokens.transition.default),
  cardFlush: cx(uiTokens.surface.card, 'overflow-hidden', uiTokens.transition.default),
  cardMuted: cx(
    'rounded-2xl border border-border bg-surface-muted shadow-sm',
    uiTokens.spacing.md,
    uiTokens.transition.default,
  ),
  panel: cx(uiTokens.surface.card, uiTokens.spacing.md, uiTokens.transition.default),

  pageTitle: uiTokens.typography.pageTitle,
  title: uiTokens.typography.title,
  sectionTitle: uiTokens.typography.sectionTitle,
  subtitle: uiTokens.typography.subtitle,
  body: uiTokens.typography.body,
  label: uiTokens.typography.label,
  helper: uiTokens.typography.helper,

  input: uiTokens.input,
  tableWrap: uiTokens.table.wrap,
  table: uiTokens.table.base,
  tableHead: uiTokens.table.head,
  tableHeaderCell: uiTokens.table.headerCell,
  tableRow: uiTokens.table.row,
  tableCell: uiTokens.table.cell,
  tableCellPrimary: uiTokens.table.cellPrimary,

  badge: uiTokens.badge,
  radius: uiTokens.radius,
  spacing: uiTokens.spacing,
  shadow: uiTokens.shadow,
  transition: uiTokens.transition,

  /** Controles do header — mesmo peso do operacional */
  iconBtn:
    'rounded-xl border border-transparent p-2.5 text-foreground-secondary transition-all duration-150 hover:border-border hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
  iconBtnSolid:
    'rounded-xl border border-border bg-surface p-2.5 text-foreground-secondary shadow-sm transition-all duration-150 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300',

  sessionChip:
    'hidden items-center gap-2 rounded-xl border border-border bg-surface-muted px-2.5 py-1.5 text-xs text-foreground-secondary lg:flex',

  sidebar:
    'relative z-20 flex h-full shrink-0 flex-col border-r border-border bg-[var(--ds-sidebar)] text-foreground-secondary shadow-card backdrop-blur-xl transition-all',
  sidebarHeader: 'flex h-16 items-center justify-between border-b border-border bg-surface/70 px-4',
  sidebarFooter: 'space-y-1 border-t border-border bg-surface-muted/80 px-2 py-3',
  navActive:
    'border border-indigo-200 bg-[var(--ds-sidebar-active)] text-indigo-700 shadow-sm ring-1 ring-indigo-100 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-transparent',
  navIdle:
    'border border-transparent text-foreground-secondary hover:bg-[var(--ds-sidebar-hover)] hover:text-foreground',

  button: buttonStyles,
  btnPrimary: cx(buttonStyles.base, buttonStyles.primary),
  btnSecondary: cx(buttonStyles.base, buttonStyles.secondary),
  btnOutline: cx(buttonStyles.base, buttonStyles.outline),
  btnGhost: cx(buttonStyles.base, buttonStyles.ghost),
  btnDanger: cx(buttonStyles.base, buttonStyles.danger),
} as const;

export { buttonStyles, uiTokens, cx };
