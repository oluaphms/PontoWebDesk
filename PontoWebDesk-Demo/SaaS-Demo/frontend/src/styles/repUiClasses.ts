import { cx } from './cx';
import { repUiPatterns, uiTokens } from './tokens';

/**
 * Classes compartilhadas do hub REP — alinhadas ao Design System light/dark.
 * Preferir tokens semânticos (surface, border, tipografia) para profundidade no modo claro.
 */
export const repUiClasses = {
  modalOverlay: 'fixed inset-0 z-[138] flex items-center justify-center bg-[var(--ds-overlay)] p-3 sm:p-4',
  modalOverlayScrollable: 'fixed inset-0 z-[138] flex items-center justify-center bg-[var(--ds-overlay)] p-3 sm:p-4 overflow-y-auto',
  modalPanelMd: cx(repUiPatterns.modal, 'bg-surface-raised w-full max-w-md border border-border-strong shadow-elevated'),
  modalPanelLg: cx(
    repUiPatterns.modal,
    'bg-surface-raised w-full max-w-lg my-auto border border-border-strong shadow-elevated max-h-[90vh] overflow-y-auto'
  ),
  modalTitle: cx(uiTokens.typography.sectionTitle),
  modalSubtitle: cx(uiTokens.typography.subtitle, 'mt-1 mb-4'),
  cardBase: cx(uiTokens.surface.card, uiTokens.spacing.md),
  cardMuted: 'bg-surface-muted border border-border',
  labelCaps: cx(uiTokens.typography.label),
  stackY3: 'space-y-3',
  actionsEnd: 'mt-6 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end',
  optionCard:
    'flex gap-3 cursor-pointer rounded-xl border border-border-strong bg-surface p-3 shadow-card transition-colors hover:bg-surface-2 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50/80 dark:has-[:checked]:bg-emerald-950/30',
  optionTitle: 'font-medium text-foreground',
  optionDesc: cx(uiTokens.typography.helper, 'block mt-0.5'),
  sectionText: cx(uiTokens.typography.helper, 'mb-2'),
  selectBase: uiTokens.input,
  modalOverlay130: 'fixed inset-0 z-[130] flex items-center justify-center bg-[var(--ds-overlay)] p-3 sm:p-4',
  modalOverlay140: 'fixed inset-0 z-[140] flex items-center justify-center bg-[var(--ds-overlay)] p-3 sm:p-4',
  modalPanelLgRead: cx(repUiPatterns.modal, 'bg-surface-raised w-full max-w-lg max-h-[80vh] flex flex-col border border-border-strong shadow-elevated'),
  modalPanelXlRead: cx(repUiPatterns.modal, 'bg-surface-raised w-full max-w-2xl max-h-[85vh] flex flex-col border border-border-strong shadow-elevated'),
  modalPanel4xl: cx(repUiPatterns.modal, 'bg-surface-raised w-full max-w-4xl max-h-[90vh] flex flex-col border border-border-strong shadow-elevated'),
  headingLg: 'text-lg font-semibold tracking-tight text-foreground',
  textXsMuted: uiTokens.typography.helper,
  textSmMuted: uiTokens.typography.subtitle,
  textSmBody: 'text-sm text-foreground-secondary',
  tableWrap: 'ds-table-wrap overflow-auto flex-1',
  tableBase: 'ds-table w-full text-sm text-left',
  tableHead: 'bg-[var(--ds-table-head)] sticky top-0 z-[1]',
  tableHeaderCell: 'px-3 py-3 text-xs font-semibold uppercase tracking-wide text-foreground-secondary',
  tableRowHover: 'border-b border-[var(--ds-divider)] even:bg-[var(--ds-table-row-alt)] hover:bg-[var(--ds-table-row-hover)] transition-colors',
  tableCellPrimary: 'px-3 py-3 font-medium text-foreground',
  tableCellMuted: 'px-3 py-3 text-foreground-secondary',
  panelWarn: 'mt-4 p-3 rounded-xl border border-amber-200/80 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 shadow-card',
  panelDanger: 'mt-3 p-3 rounded-xl border border-red-200/80 dark:border-red-700/50 bg-red-50 dark:bg-red-950/30 shadow-card',
  panelNeutral: 'mt-4 p-3 rounded-xl bg-surface-muted border border-border space-y-3 shadow-card',
  sectionTopBorder: 'border-t border-[var(--ds-divider)] pt-3',
  inputCheck: 'w-4 h-4 rounded border-border-strong text-indigo-600 focus:ring-brand',
  selectWide: cx(uiTokens.input, 'flex-1'),
  infoCodeXs: 'text-[10px] text-foreground-muted',
} as const;
