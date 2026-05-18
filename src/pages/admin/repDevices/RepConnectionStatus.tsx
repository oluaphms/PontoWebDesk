// ⚠️ TOKEN-ONLY UI RULE
// Não utilizar classes visuais hardcoded (padding, radius, font, shadow).
// Sempre utilizar uiTokens ou helpers centralizados.
import React from 'react';
import { Button } from '../../../../components/UI';
import { AlertTriangle, PlugZap } from 'lucide-react';
import { buttonStyles } from '../../../components/ui/buttonStyles';
import { uiTokens } from '../../../styles/tokens';
import { repConnUi } from '../../../styles/repConnectionStatusUi';
import { cx } from '../../../styles/cx';

type RepConnectionStatusProps = {
  loadingList: boolean;
  agentIsActive: boolean;
  devicesQueryError: { technical: string } | null;
  onRetry: () => void;
  onOpenSetup: () => void;
};

export const RepConnectionStatus: React.FC<RepConnectionStatusProps> = ({
  loadingList,
  agentIsActive,
  devicesQueryError,
  onRetry,
  onOpenSetup,
}) => {
  if (loadingList) return null;

  if (devicesQueryError) {
    return (
      <section
        className={cx('mb-4 border border-amber-200/60 bg-amber-50/55', uiTokens.radius.card, uiTokens.spacing.cardPadding, uiTokens.shadow.card, uiTokens.transition.default, 'dark:border-amber-800/60 dark:bg-amber-950/15')}
      >
        <div className={cx('flex items-start', uiTokens.spacing.internalGap)}>
          <span className={repConnUi.c001} aria-hidden>
            <AlertTriangle size={18} />
          </span>
          <div className={repConnUi.c002}>
            <p className={repConnUi.c005}>Falha na comunicação com o backend</p>
            <p className={cx('mt-1 leading-relaxed', uiTokens.typography.subtitle)}>
              Tente novamente para atualizar o estado dos dispositivos.
            </p>
            <div className={repConnUi.c003}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cx(buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
                onClick={onRetry}
              >
                Tentar novamente
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!agentIsActive) {
    return (
      <section
        className={cx('mb-4 border border-slate-200/90 bg-white/85', uiTokens.radius.card, uiTokens.spacing.cardPadding, uiTokens.shadow.card, uiTokens.transition.default, 'dark:border-slate-700 dark:bg-slate-900/45')}
      >
        <div className={cx('flex items-start', uiTokens.spacing.internalGap)}>
          <span className={repConnUi.c004} aria-hidden>
            <PlugZap size={18} />
          </span>
          <div className={repConnUi.c002}>
            <p className={repConnUi.c005}>Aguardando agente na empresa</p>
            <p className={cx('mt-1 leading-relaxed', uiTokens.typography.subtitle)}>
              Instale o Agente PontoWebDesk no computador da empresa e mantenha-o em execução para sincronizar relógios na rede interna.
            </p>
            <div className={repConnUi.c003}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cx(buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
                onClick={onOpenSetup}
              >
                Ver como configurar
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return null;
};
