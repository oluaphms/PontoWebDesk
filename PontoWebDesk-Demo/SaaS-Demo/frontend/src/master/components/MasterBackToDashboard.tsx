import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard } from 'lucide-react';

/**
 * Link padrão para retornar à página inicial do Master.
 */
export function MasterBackToDashboard({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/master"
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-foreground-secondary transition-colors hover:text-indigo-700 dark:hover:text-indigo-300 ${className}`}
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      <LayoutDashboard className="h-3.5 w-3.5" />
      Voltar à página inicial
    </Link>
  );
}
