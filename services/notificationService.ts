/**
 * Serviço de notificações in-app
 */

import { InAppNotification } from '../types';
import { db, isSupabaseConfigured } from './supabase';

const STORAGE_KEY = 'smartponto_notifications';
const MAX_LOCAL = 100;

export const NotificationService = {
  async create(notification: Omit<InAppNotification, 'id' | 'read' | 'createdAt'>): Promise<InAppNotification> {
    const notif: InAppNotification = {
      ...notification,
      id: crypto.randomUUID(),
      read: false,
      createdAt: new Date(),
    };

    if (isSupabaseConfigured) {
      try {
        await db.insert('notifications', {
          id: notif.id,
          user_id: notif.userId,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          read: notif.read,
          created_at: notif.createdAt.toISOString(),
          action_url: notif.actionUrl ?? null,
          metadata: notif.metadata ?? {},
        });
      } catch (e) {
        console.error('Notification Supabase failed:', e);
        this.persistLocal(notif);
      }
    } else {
      this.persistLocal(notif);
    }

    return notif;
  },

  persistLocal(notif: InAppNotification) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const existing = raw ? JSON.parse(raw) : [];
      const updated = [notif, ...existing].slice(0, MAX_LOCAL);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (_) {}
  },

  async getAll(userId: string): Promise<InAppNotification[]> {
    if (isSupabaseConfigured) {
      try {
        const rows = await db.select(
          'notifications',
          [{ column: 'user_id', operator: 'eq', value: userId }],
          { column: 'created_at', ascending: false },
          100
        );
        return (rows ?? []).map((r: any) => ({
          id: r.id,
          userId: r.user_id,
          type: r.type,
          title: r.title,
          message: r.message,
          read: r.read,
          createdAt: new Date(r.created_at),
          actionUrl: r.action_url,
          metadata: r.metadata ?? {},
        }));
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '');
        const isTimeout =
          msg.includes('Tempo esgotado ao carregar dados') || msg.includes('Supabase timeout') || /timeout/i.test(msg);
        if (e?.name !== 'AbortError' && !msg.includes('Lock broken')) {
          if (isTimeout) {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[notifications] Lista indisponível (rede lenta); usando notificações locais se houver.');
            }
          } else {
            console.error('Get notifications Supabase failed:', msg);
          }
        }
      }
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw).map((n: any) => ({ ...n, createdAt: new Date(n.createdAt) }));
      return parsed.filter((n: InAppNotification) => n.userId === userId);
    } catch {
      return [];
    }
  },

  async getUnreadCount(userId: string): Promise<number> {
    const all = await this.getAll(userId);
    return all.filter((n) => !n.read).length;
  },

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    if (isSupabaseConfigured) {
      try {
        await db.update('notifications', notificationId, { read: true });
      } catch (e) {
        console.error('Mark read Supabase failed:', e);
      }
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const updated = parsed.map((n: any) =>
        n.id === notificationId && n.userId === userId ? { ...n, read: true } : n
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  },

  async markAllAsRead(userId: string): Promise<void> {
    const all = await this.getAll(userId);
    for (const n of all) {
      if (!n.read) await this.markAsRead(userId, n.id);
    }
  },
};
