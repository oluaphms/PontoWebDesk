// ⚠️ TOKEN-ONLY UI RULE
// Não utilizar classes visuais hardcoded (padding, radius, font, shadow).
// Sempre utilizar uiTokens ou helpers centralizados.
import React, { type RefObject, useState } from 'react';
import { Button } from '../../../../components/UI';
import { CheckCircle2, CircleDashed, Copy } from 'lucide-react';
import { buttonStyles } from '../../../components/ui/buttonStyles';
import { uiTokens } from '../../../styles/tokens';
import { repSetupUi } from '../../../styles/repSetupGuideUi';
import { cx } from '../../../styles/cx';

type RepSetupGuideProps = {
  setupGuideRef: RefObject<HTMLElement | null>;
  agentIsActive: boolean;
  onCopyCommand: (command: string) => void;
};

type StepItemProps = {
  index: number;
  title: string;
  description: string;
  done: boolean;
  children?: React.ReactNode;
};

const StepItem: React.FC<StepItemProps> = ({ index, title, description, done, children }) => (
  <li
    className={cx('border border-slate-200/80 bg-white/85', uiTokens.radius.card, uiTokens.spacing.cardPadding, uiTokens.shadow.card, uiTokens.transition.default, 'dark:border-slate-700 dark:bg-slate-900/50')}
  >
    <div className={cx('flex items-start', uiTokens.spacing.internalGap)}>
      <span className={repSetupUi.c001}>
        {index}
      </span>
      <span className={repSetupUi.c002} aria-hidden>
        {done ? <CheckCircle2 size={18} className={repSetupUi.c003} /> : <CircleDashed size={18} />}
      </span>
      <div className={repSetupUi.c004}>
        <p className={cx(uiTokens.typography.label, 'uppercase tracking-wide')}>Passo {index}</p>
        <p className={repSetupUi.c008}>{title}</p>
        <p className={cx('mt-1 leading-relaxed', uiTokens.typography.subtitle)}>{description}</p>
        {children}
      </div>
    </div>
  </li>
);

export const RepSetupGuide: React.FC<RepSetupGuideProps> = ({ setupGuideRef, agentIsActive, onCopyCommand }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = 'rep-setup-guide-content';

  return (
    <section
      ref={setupGuideRef}
      id="rep-setup-guide"
      className={cx('mb-4 border border-slate-200/90 bg-slate-50/75', uiTokens.radius.card, uiTokens.spacing.cardPadding, uiTokens.shadow.card, uiTokens.transition.default, 'dark:border-slate-700 dark:bg-slate-900/45')}
    >
      <header className={repSetupUi.c005}>
        <div className={repSetupUi.c012}>
          <h2 className={repSetupUi.c009}>Configuração do agente local</h2>
          <button
            type="button"
            className={repSetupUi.c013}
            aria-expanded={isExpanded}
            aria-controls={contentId}
            onClick={() => setIsExpanded((prev) => !prev)}
          >
            {isExpanded ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        <p className={cx('mt-1 leading-relaxed', uiTokens.typography.subtitle)}>
          Agente local realiza a comunicação com os dispositivos
        </p>
      </header>

      {isExpanded && (
        <ol id={contentId} className={cx('grid', uiTokens.spacing.internalGap, 'sm:grid-cols-3')}>
          <StepItem
            index={1}
            title="Instale o agente local"
            description="Instale no computador da empresa que está na mesma rede dos relógios."
            done={agentIsActive}
          />
          <StepItem
            index={2}
            title="Execute o agente na rede"
            description="Inicie o agente para habilitar a coleta automática."
            done={agentIsActive}
          >
            <div className={repSetupUi.c010}>
              <code className={repSetupUi.c006}>npm run rep:agent</code>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cx('mt-3', buttonStyles.base, buttonStyles.ghost, uiTokens.radius.button, uiTokens.transition.default)}
              onClick={() => onCopyCommand('npm run rep:agent')}
            >
              <Copy size={14} className={repSetupUi.c007} />
              Copiar comando
            </Button>
          </StepItem>
          <StepItem
            index={3}
            title="Aguarde sincronização automática"
            description="Após iniciar o agente, a coleta começa automaticamente."
            done={agentIsActive}
          />
        </ol>
      )}
    </section>
  );
};
