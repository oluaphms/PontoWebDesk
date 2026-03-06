import React, { memo } from 'react';
import { Menu } from 'lucide-react';

export interface MenuToggleButtonProps {
  onClick: () => void;
  'aria-expanded'?: boolean;
  className?: string;
}

const MenuToggleButton: React.FC<MenuToggleButtonProps> = ({
  onClick,
  'aria-expanded': ariaExpanded = false,
  className = '',
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors ${className}`}
    aria-label="Abrir menu de navegação"
    aria-expanded={ariaExpanded}
  >
    <Menu size={24} aria-hidden />
  </button>
);

export default memo(MenuToggleButton);
