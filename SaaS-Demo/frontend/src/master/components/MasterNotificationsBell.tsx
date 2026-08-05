import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  fetchMasterNotifications,
  markMasterNotificationsReadAll,
  type MasterNotification,
} from '../api/companiesApi';
import { cx, masterUi } from '../ui/masterUi';

/**
 * Sino de notificações Master (FASE 30 — Automação Comercial).
 */
export function MasterNotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MasterNotification[]>([]);
  const [unread, setUnread] = useState(0);

  async function load() {
    try {
      const res = await fetchMasterNotifications(20);
      setItems(res.notifications);
      setUnread(res.unreadCount);
    } catch {
      // silencioso — painel continua utilizável
    }
  }

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, []);

  async function markAll() {
    try {
      await markMasterNotificationsReadAll();
      await load();
    } catch {
      // ignore
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        className={cx('relative', masterUi.iconBtnSolid)}
        aria-label="Notificações Master"
        title="Notificações"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-auto rounded-xl border border-border bg-surface shadow-elevated">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-foreground">Notificações</span>
            <button
              type="button"
              onClick={() => void markAll()}
              className="text-[10px] font-medium text-indigo-600 hover:underline dark:text-indigo-300"
            >
              Marcar lidas
            </button>
          </div>
          {items.length === 0 ? (
            <p className={cx(masterUi.helper, 'px-3 py-4')}>Nenhuma notificação.</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`px-3 py-2.5 ${n.read ? 'opacity-70' : 'bg-indigo-500/5'}`}
                >
                  <p className="text-xs font-semibold text-foreground">{n.title}</p>
                  <p className={cx(masterUi.helper, 'mt-0.5')}>{n.message}</p>
                  <p className="mt-1 text-[10px] text-foreground-disabled">
                    {n.level}
                    {n.tenantId ? ` · ${n.tenantId.slice(0, 12)}…` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
