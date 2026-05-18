import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../../../components/UI';
import { buttonStyles } from '../../../components/ui/buttonStyles';
import { repUiPatterns, uiTokens } from '../../../styles/tokens';
import { cx } from '../../../styles/cx';

export type RepDeviceDeleteModalProps = {
  open: boolean;
  deviceName: string;
  historyCount: number;
  busy: boolean;
  onCancel: () => void;
  onDeactivate: () => void;
  onForceDelete: () => void;
};

export const RepDeviceDeleteModal: React.FC<RepDeviceDeleteModalProps> = ({
  open,
  deviceName,
  historyCount,
  busy,
  onCancel,
  onDeactivate,
  onForceDelete,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rep-delete-modal-title"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className={cx(repUiPatterns.modal, 'bg-white dark:bg-slate-800 w-full max-w-md p-6', uiTokens.shadow.card)}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="rep-delete-modal-title" className="text-lg font-semibold text-slate-900 dark:text-white">
          Excluir relógio
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          O dispositivo <span className="font-medium text-slate-900 dark:text-white">«{deviceName}»</span> possui{' '}
          <span className="font-semibold">{historyCount}</span> registro(s) vinculado(s) em{' '}
          <code className="text-xs">rep_punch_logs</code>.
        </p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Por padrão, relógios com histórico são <strong>desativados</strong> (não removidos) para preservar auditoria e
          batidas. Use «Excluir mesmo assim» apenas se tiver certeza.
        </p>
        <div className={cx('mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2', uiTokens.spacing.internalGap)}>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            className={cx(buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button)}
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            className={cx(buttonStyles.base, buttonStyles.secondary, uiTokens.radius.button)}
            onClick={onDeactivate}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1 inline" aria-hidden /> : null}
            Desativar
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            className={cx(buttonStyles.base, 'bg-red-600 hover:bg-red-700 text-white', uiTokens.radius.button)}
            onClick={onForceDelete}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1 inline" aria-hidden /> : null}
            Excluir mesmo assim
          </Button>
        </div>
      </div>
    </div>
  );
};
