import React from 'react';
import { Button } from '../../../../components/UI';
import { repPageUi } from '../../../styles/repDevicesPageUi';
import { repUiClasses } from '../../../styles/repUiClasses';
import { cx } from '../../../styles/cx';

export type RepDetailReadModalProps = {
  open: boolean;
  title: string;
  body: string;
  onClose: () => void;
};

export const RepDetailReadModal: React.FC<RepDetailReadModalProps> = ({
  open,
  title,
  body,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div
      className={repUiClasses.modalOverlay130}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={repUiClasses.modalPanelLgRead}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={cx(repUiClasses.headingLg, 'mb-2')}>{title}</h2>
        <pre className={repPageUi.c058}>
          {body}
        </pre>
        <Button className={repPageUi.c059} variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
};
