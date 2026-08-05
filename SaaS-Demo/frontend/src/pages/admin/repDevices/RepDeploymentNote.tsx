// ⚠️ TOKEN-ONLY UI RULE
// Não utilizar classes visuais hardcoded (padding, radius, font, shadow).
// Sempre utilizar uiTokens ou helpers centralizados.
import React from 'react';
import { repDeployUi } from '../../../styles/repDeploymentNoteUi';

type RepDeploymentNoteProps = {
  repDeploymentNote: boolean;
};

export const RepDeploymentNote: React.FC<RepDeploymentNoteProps> = ({ repDeploymentNote }) => {
  if (!repDeploymentNote) return null;

  return (
    <details className={repDeployUi.c002}>
      <summary className={repDeployUi.c003}>
        Implantação: nuvem vs rede local (clique para expandir)
      </summary>
      <div className={repDeployUi.c004}>
        Em produção na nuvem, a comunicação com relógios na rede interna depende do agente local.
        <br />
        <span className={repDeployUi.c001}>Agente local realiza a comunicação com os dispositivos</span> e envia os dados para o sistema.
      </div>
    </details>
  );
};
