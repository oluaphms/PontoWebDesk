import React, { memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export interface SidebarItemProps {
  path: string;
  label: string;
  icon: LucideIcon;
  collapsed?: boolean;
  badge?: number;
  onAfterNavigate?: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({
  path,
  label,
  icon: Icon,
  collapsed = false,
  badge,
  onAfterNavigate,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = location.pathname === path;

  const handleClick = () => {
    navigate(path);
    onAfterNavigate?.();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={isActive ? 'page' : undefined}
      className={`
        group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5
        text-left text-sm font-medium transition-all duration-200
        outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2
        dark:focus-visible:ring-offset-slate-900
        ${collapsed ? 'justify-center px-2' : ''}
        ${isActive
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
        }
      `}
      title={collapsed ? label : undefined}
    >
      {isActive && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full opacity-90"
          aria-hidden
        />
      )}
      <span className={isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-white'}>
        <Icon size={20} strokeWidth={isActive ? 2.5 : 2} aria-hidden />
      </span>
      {!collapsed && (
        <>
          <span className={`flex-1 truncate ${isActive ? 'font-semibold' : ''}`}>
            {label}
          </span>
          {badge != null && badge > 0 && (
            <span className="min-w-[1.25rem] rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
      {collapsed && badge != null && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
};

export default memo(SidebarItem);
