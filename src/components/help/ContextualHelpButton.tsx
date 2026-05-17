import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleHelp } from 'lucide-react';
import { openHelp } from '../../help/openHelp';
import type { HelpDocSlug } from '../../help/helpCenterCatalog';

interface ContextualHelpButtonProps {
  docSlug: HelpDocSlug | string;
  label?: string;
  className?: string;
  variant?: 'button' | 'icon';
}

export const ContextualHelpButton: React.FC<ContextualHelpButtonProps> = ({
  docSlug,
  label = 'Ajuda',
  className = '',
  variant = 'button',
}) => {
  const navigate = useNavigate();

  const handleClick = () => {
    openHelp(docSlug, navigate);
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={label}
        aria-label={label}
        className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors ${className}`}
      >
        <CircleHelp size={18} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300 transition-colors ${className}`}
    >
      <CircleHelp size={16} />
      {label}
    </button>
  );
};

export default ContextualHelpButton;
