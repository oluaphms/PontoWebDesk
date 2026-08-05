/**
 * Notificações Master (in-memory) — FASE 30 Automação Comercial.
 * Sem push externo; painel Master consome via API.
 */
import { randomUUID } from 'node:crypto';

export type MasterNotificationLevel = 'info' | 'success' | 'warn' | 'error';

export type MasterNotification = {
  id: string;
  at: string;
  tenantId: string | null;
  title: string;
  message: string;
  level: MasterNotificationLevel;
  read: boolean;
};

const MAX = 500;
const items: MasterNotification[] = [];

export const MasterNotifications = {
  append(input: {
    tenantId?: string | null;
    title: string;
    message: string;
    level?: MasterNotificationLevel;
  }): MasterNotification {
    const row: MasterNotification = {
      id: `ntf_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      at: new Date().toISOString(),
      tenantId: input.tenantId ?? null,
      title: input.title,
      message: input.message,
      level: input.level ?? 'info',
      read: false,
    };
    items.unshift(row);
    if (items.length > MAX) items.length = MAX;
    return { ...row };
  },

  list(limit = 50, tenantId?: string | null): MasterNotification[] {
    const safe = Math.min(Math.max(limit, 1), 200);
    const filtered = tenantId
      ? items.filter((n) => n.tenantId === tenantId)
      : items;
    return filtered.slice(0, safe).map((n) => ({ ...n }));
  },

  unreadCount(tenantId?: string | null): number {
    return this.list(200, tenantId).filter((n) => !n.read).length;
  },

  markRead(id: string): MasterNotification | null {
    const row = items.find((n) => n.id === id);
    if (!row) return null;
    row.read = true;
    return { ...row };
  },

  markAllRead(tenantId?: string | null): number {
    let n = 0;
    for (const row of items) {
      if (tenantId && row.tenantId !== tenantId) continue;
      if (!row.read) {
        row.read = true;
        n += 1;
      }
    }
    return n;
  },

  clear(): void {
    items.length = 0;
  },
};
