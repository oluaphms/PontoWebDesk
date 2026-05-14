import { cx } from './cx';
import { repUiPatterns, uiTokens } from './tokens';

export const repUiClasses = {
  modalOverlay: 'fixed inset-0 z-[138] flex items-center justify-center bg-black/55 p-3 sm:p-4',
  modalOverlayScrollable: 'fixed inset-0 z-[138] flex items-center justify-center bg-black/55 p-3 sm:p-4 overflow-y-auto',
  modalPanelMd: cx(repUiPatterns.modal, 'bg-white dark:bg-slate-800 w-full max-w-md border border-slate-200 dark:border-slate-600'),
  modalPanelLg: cx(
    repUiPatterns.modal,
    'bg-white dark:bg-slate-800 w-full max-w-lg my-auto border border-slate-200 dark:border-slate-600 max-h-[90vh] overflow-y-auto'
  ),
  modalTitle: cx(uiTokens.typography.sectionTitle, 'text-slate-900 dark:text-white'),
  modalSubtitle: cx(uiTokens.typography.subtitle, 'mt-1 mb-4'),
  cardBase: cx(uiTokens.radius.card, 'border border-slate-200 dark:border-slate-600', uiTokens.spacing.md),
  cardMuted: 'bg-slate-50/50 dark:bg-slate-900/20',
  labelCaps: cx(uiTokens.typography.label, 'uppercase tracking-wide'),
  stackY3: 'space-y-3',
  actionsEnd: 'mt-6 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end',
  optionCard:
    'flex gap-3 cursor-pointer rounded-xl border border-slate-200 dark:border-slate-600 p-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50/80 dark:has-[:checked]:bg-emerald-950/30',
  optionTitle: 'font-medium text-slate-900 dark:text-white',
  optionDesc: 'block text-xs text-slate-500 dark:text-slate-400 mt-0.5',
  sectionText: 'text-xs text-slate-500 dark:text-slate-400 mb-2',
  selectBase:
    'w-full px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm',
  modalOverlay130: 'fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-3 sm:p-4',
  modalOverlay140: 'fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-3 sm:p-4',
  modalPanelLgRead: cx(repUiPatterns.modal, 'bg-white dark:bg-slate-800 w-full max-w-lg max-h-[80vh] flex flex-col'),
  modalPanelXlRead: cx(repUiPatterns.modal, 'bg-white dark:bg-slate-800 w-full max-w-2xl max-h-[85vh] flex flex-col'),
  modalPanel4xl: cx(repUiPatterns.modal, 'bg-white dark:bg-slate-800 w-full max-w-4xl max-h-[90vh] flex flex-col'),
  headingLg: 'text-lg font-bold text-slate-900 dark:text-white',
  textXsMuted: 'text-xs text-slate-500 dark:text-slate-400',
  textSmMuted: 'text-sm text-slate-500 dark:text-slate-400',
  textSmBody: 'text-sm text-slate-700 dark:text-slate-300',
  tableWrap: 'overflow-auto flex-1 rounded-lg border border-slate-200 dark:border-slate-600',
  tableBase: 'w-full text-sm text-left',
  tableHead: 'bg-slate-50 dark:bg-slate-900/50 sticky top-0',
  tableHeaderCell: 'px-3 py-2 font-medium text-slate-700 dark:text-slate-300',
  tableRowHover: 'hover:bg-slate-50/80 dark:hover:bg-slate-700/30',
  tableCellPrimary: 'px-3 py-2 text-slate-800 dark:text-slate-100',
  tableCellMuted: 'px-3 py-2 text-slate-600 dark:text-slate-300',
  panelWarn: 'mt-4 p-3 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/15',
  panelDanger: 'mt-3 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20',
  panelNeutral: 'mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 space-y-3',
  sectionTopBorder: 'border-t border-slate-200 dark:border-slate-700 pt-3',
  inputCheck: 'w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500',
  selectWide: 'flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm',
  infoCodeXs: 'text-[10px]',
} as const;
