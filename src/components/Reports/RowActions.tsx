// ============================================================
// Componente de Ações por Linha para Relatórios
// ============================================================

import React from 'react';
import {
  Edit3,
  FileText,
  Shield,
  Clock,
  UserCheck,
  AlertTriangle,
  CheckCircle,
  XCircle,
  MoreHorizontal,
  Eye,
} from 'lucide-react';

export type ActionType =
  | 'edit'
  | 'justify'
  | 'view'
  | 'approve'
  | 'reject'
  | 'audit'
  | 'time'
  | 'verify'
  | 'alert'
  | 'check';

export interface RowAction {
  type: ActionType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

interface RowActionsProps {
  actions: RowAction[];
  size?: 'sm' | 'md';
  showLabels?: boolean;
}

const iconMap: Record<ActionType, React.ReactNode> = {
  edit: <Edit3 className="w-4 h-4" />,
  justify: <FileText className="w-4 h-4" />,
  view: <Eye className="w-4 h-4" />,
  approve: <CheckCircle className="w-4 h-4" />,
  reject: <XCircle className="w-4 h-4" />,
  audit: <Shield className="w-4 h-4" />,
  time: <Clock className="w-4 h-4" />,
  verify: <UserCheck className="w-4 h-4" />,
  alert: <AlertTriangle className="w-4 h-4" />,
  check: <CheckCircle className="w-4 h-4" />,
};

const variantClasses = {
  primary: 'bg-indigo-600 hover:bg-indigo-700 text-white border-transparent',
  secondary: 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600',
  danger: 'bg-red-600 hover:bg-red-700 text-white border-transparent',
  ghost: 'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent',
};

export const RowActions: React.FC<RowActionsProps> = ({
  actions,
  size = 'sm',
  showLabels = false,
}) => {
  const sizeClasses = size === 'sm'
    ? 'px-2 py-1 text-xs'
    : 'px-3 py-1.5 text-sm';

  const visibleActions = actions.slice(0, 3);
  const moreActions = actions.slice(3);

  return (
    <div className="flex items-center gap-1">
      {visibleActions.map((action, index) => (
        <button
          key={action.type + index}
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
          disabled={action.disabled || action.loading}
          className={`
            inline-flex items-center gap-1.5 rounded-lg border
            transition-all duration-200
            ${variantClasses[action.variant || 'ghost']}
            ${sizeClasses}
            ${(action.disabled || action.loading) ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          title={!showLabels ? action.label : undefined}
        >
          {action.loading ? (
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            iconMap[action.type]
          )}
          {showLabels && <span>{action.label}</span>}
        </button>
      ))}

      {moreActions.length > 0 && (
        <div className="relative group">
          <button
            className={`
              inline-flex items-center justify-center rounded-lg border
              border-slate-300 dark:border-slate-600
              hover:bg-slate-100 dark:hover:bg-slate-800
              transition-all
              ${sizeClasses}
            `}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-50 min-w-[160px]">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1">
              {moreActions.map((action, index) => (
                <button
                  key={action.type + index}
                  onClick={(e) => {
                    e.stopPropagation();
                    action.onClick();
                  }}
                  disabled={action.disabled || action.loading}
                  className={`
                    w-full flex items-center gap-2 px-3 py-2 text-sm
                    hover:bg-slate-50 dark:hover:bg-slate-800
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${action.variant === 'danger' ? 'text-red-600' : 'text-slate-700 dark:text-slate-300'}
                  `}
                >
                  {iconMap[action.type]}
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Hook helper para criar ações comuns
export const useRowActions = () => {
  const createEditAction = (onClick: () => void, disabled?: boolean): RowAction => ({
    type: 'edit',
    label: 'Corrigir',
    onClick,
    disabled,
    variant: 'primary',
  });

  const createJustifyAction = (onClick: () => void, disabled?: boolean): RowAction => ({
    type: 'justify',
    label: 'Justificar',
    onClick,
    disabled,
    variant: 'secondary',
  });

  const createViewAction = (onClick: () => void): RowAction => ({
    type: 'view',
    label: 'Ver detalhe',
    onClick,
    variant: 'ghost',
  });

  const createAuditAction = (onClick: () => void, fraudScore?: number): RowAction => ({
    type: 'audit',
    label: 'Auditar',
    onClick,
    variant: fraudScore && fraudScore > 70 ? 'danger' : 'secondary',
  });

  return {
    createEditAction,
    createJustifyAction,
    createViewAction,
    createAuditAction,
  };
};

export default RowActions;
