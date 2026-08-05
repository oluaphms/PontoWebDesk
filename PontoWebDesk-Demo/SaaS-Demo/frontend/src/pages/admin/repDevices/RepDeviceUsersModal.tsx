import React from 'react';
import { Button } from '../../../../components/UI';
import { toUiString } from '../../../../modules/rep-integration/repDeviceBrowser';
import type { RepUserFromDevice } from '../../../../modules/rep-integration/types';
import { repPageUi } from '../../../styles/repDevicesPageUi';
import { repUiClasses } from '../../../styles/repUiClasses';
import { cx } from '../../../styles/cx';

export type RepDeviceUsersModalProps = {
  open: boolean;
  title: string;
  users: RepUserFromDevice[];
  onClose: () => void;
};

export const RepDeviceUsersModal: React.FC<RepDeviceUsersModalProps> = ({
  open,
  title,
  users,
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
        className={repUiClasses.modalPanelXlRead}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={cx(repUiClasses.headingLg, 'mb-3')}>{title}</h2>
        <p className={cx(repUiClasses.textXsMuted, 'mb-2')}>
          Somente leitura — não altera o cadastro no PontoWebDesk.
        </p>
        <div className={cx(repUiClasses.tableWrap, 'max-h-[55vh]')}>
          <table className={repUiClasses.tableBase}>
            <thead className={repUiClasses.tableHead}>
              <tr>
                <th className={repUiClasses.tableHeaderCell}>Nome</th>
                <th className={repUiClasses.tableHeaderCell}>CPF/PIS</th>
                <th className={repUiClasses.tableHeaderCell}>Matrícula</th>
              </tr>
            </thead>
            <tbody className={repPageUi.c060}>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={3} className={repPageUi.c061}>
                    Nenhum usuário retornado.
                  </td>
                </tr>
              ) : (
                users.map((u, i) => (
                  <tr key={i} className={repUiClasses.tableRowHover}>
                    <td className={repUiClasses.tableCellPrimary}>{toUiString(u.nome || '—')}</td>
                    <td className={repUiClasses.tableCellMuted}>
                      {toUiString(u.cpf || u.pis || '—')}
                    </td>
                    <td className={repUiClasses.tableCellMuted}>{toUiString(u.matricula || '—')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Button className={repPageUi.c059} variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
};
