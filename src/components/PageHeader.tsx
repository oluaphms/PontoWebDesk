import React from 'react';
import { ReactNode } from 'react';
import { ContextualHelpButton } from './help/ContextualHelpButton';
import { ExplainThisButton } from './help/ExplainThisButton';
import type { HelpDocSlug } from '../help/helpCenterCatalog';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Slug da documentação em /docs/operacional — exibe botão Ajuda contextual */
  helpSlug?: HelpDocSlug | string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, icon, actions, helpSlug, helpSection }) => {
  const iconElement =
    icon &&
    (React.isValidElement(icon)
      ? icon
      : typeof icon === 'function'
        ? React.createElement(icon as React.ComponentType, { size: 24 })
        : icon);

  const actionSlot = (
    <>
      {helpSlug && <ContextualHelpButton docSlug={helpSlug} />}
      {actions}
    </>
  );

  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
      <div className="flex items-start gap-3">
        {iconElement && (
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            {iconElement}
          </div>
        )}
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            {title}
            {helpSlug && helpSection && <ExplainThisButton doc={helpSlug} section={helpSection} />}
          </h1>
          {subtitle && <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>}
        </div>
      </div>
      {(helpSlug || actions) && <div className="flex items-center gap-2 flex-wrap">{actionSlot}</div>}
    </header>
  );
};

export default PageHeader;
