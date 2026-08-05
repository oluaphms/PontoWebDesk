import React from 'react';
import { cx, masterUi } from '../ui/masterUi';

type MasterPageProps = {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** default | narrow — mesma hierarquia do operacional */
  width?: 'default' | 'narrow';
  className?: string;
};

/**
 * Shell de página Master alinhado ao conteúdo do Layout operacional.
 */
export function MasterPage({
  title,
  subtitle,
  actions,
  children,
  width = 'default',
  className,
}: MasterPageProps) {
  return (
    <div className={cx(width === 'narrow' ? masterUi.pageNarrow : masterUi.page, className)}>
      {(title || actions) && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            {title ? <h1 className={masterUi.pageTitle}>{title}</h1> : null}
            {subtitle ? <p className={masterUi.subtitle}>{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
        </header>
      )}
      {children}
    </div>
  );
}

type MasterCardProps = {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
};

export function MasterCard({ children, className, padded = true }: MasterCardProps) {
  return (
    <div className={cx(padded ? masterUi.card : masterUi.cardFlush, className)}>{children}</div>
  );
}
