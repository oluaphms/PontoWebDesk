import React from 'react';
import { Moon, PanelLeft, Shield, Sun } from 'lucide-react';
import { getMasterSession } from '../api/masterApi';
import { MasterNotificationsBell } from './MasterNotificationsBell';
import { MasterGlobalSearch } from './MasterGlobalSearch';
import { masterUi } from '../ui/masterUi';

type MasterTopbarProps = {
  title?: string;
  isDark: boolean;
  onToggleTheme: () => void;
  onToggleSidebar?: () => void;
};

export function MasterTopbar({
  title = 'Painel Master',
  isDark,
  onToggleTheme,
  onToggleSidebar,
}: MasterTopbarProps) {
  const session = getMasterSession();
  const themeLabel = isDark ? 'Ativar modo claro' : 'Ativar modo escuro';

  return (
    <header className="ds-header-bar flex h-16 shrink-0 items-center justify-between gap-3 px-4 shadow-sm transition-colors duration-300 sm:gap-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className={masterUi.iconBtn}
            aria-label="Alternar menu"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
        <div className="hidden min-w-0 sm:block md:max-w-[160px] lg:max-w-[220px]">
          <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">{title}</h1>
          <p className={`truncate ${masterUi.helper}`}>PontoWebDesk · Master</p>
        </div>
        <MasterGlobalSearch />
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <MasterNotificationsBell />
        <div className={masterUi.sessionChip}>
          <Shield className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-300" />
          <span className="max-w-[140px] truncate font-medium">{session?.email || 'Master'}</span>
          <span className="text-foreground-disabled">·</span>
          <span className="font-semibold text-indigo-700 dark:text-indigo-300">
            {session?.role || '—'}
          </span>
        </div>
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        <button
          type="button"
          onClick={onToggleTheme}
          className={`${masterUi.iconBtn} group`}
          aria-label={themeLabel}
          title={themeLabel}
        >
          <span className="block transition-transform group-hover:scale-110">
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </span>
        </button>
      </div>
    </header>
  );
}
