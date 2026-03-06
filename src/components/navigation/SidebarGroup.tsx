import React, { memo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SidebarGroupProps {
  title: string;
  collapsed?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const SidebarGroup: React.FC<SidebarGroupProps> = ({
  title,
  collapsed = false,
  defaultOpen = true,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  if (collapsed) {
    return <div className="space-y-1">{children}</div>;
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors duration-200"
        aria-expanded={open}
      >
        <span>{title}</span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
          aria-hidden
        />
      </button>
      <div
        className={`grid transition-all duration-200 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
};

export default memo(SidebarGroup);
