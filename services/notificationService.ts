/**
 * Serviço de notificações in-app
 */

import { InAppNotification, NotificationStatus } from '../types';
import { db, isSupabaseConfigured, supabase, type Filter } from './supabaseClient';

const STORAGE_KEY = 'smartponto_notifications';
const MAX_LOCAL = 100;

function rowToNotif(r: any): InAppNotification {
  const read: boolean = r.read ?? false;
  const status: NotificationStatus = (r.status as NotificationStatus) ?? (read ? 'read' : 'pending');
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    title: r.title,
    message: r.message,
    read,
    status,
    createdAt: new Date(r.created_at),
    actionUrl: r.action_url,
    metadata: r.metadata ?? {},
  };
}

export const NotificationService = {
  async create(
    notification: Omit<InAppNotification, 'id' | 'read' | 'status' | 'createdAt'>,
  ): Promise<InAppNotification> {
    const notif: InAppNotification = {
      ...notification,
      id: crypto.randomUUID(),
      read: false,
      status: 'pending',
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
          status: notif.status,
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

  /**
   * Retorna notificações do usuário.
   * Por padrão exclui as já lidas (read = true) para não poluir o sino.
   */
  async getAll(userId: string, includeResolved = false): Promise<InAppNotification[]> {
    if (isSupabaseConfigured) {
      try {
        const filters: Filter[] = [
          { column: 'user_id', operator: 'eq', value: userId },
          // Mostrar apenas notificações não lidas (read = false)
          { column: 'read', operator: 'eq', value: false },
        ];
        const rows = await db.select(
          'notifications',
          filters,
          { column: 'created_at', ascending: false },
          100,
        );
        return (rows ?? []).map(rowToNotif);
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '');
        const isTimeout =
          msg.includes('Tempo esgotado') ||
          msg.includes('Tempo esgotado ao carregar dados') ||
          msg.includes('Supabase timeout') ||
          /timeout/i.test(msg);
        if (e?.name !== 'AbortError' && !msg.includes('Lock broken') && !msg.includes('stole')) {
          if (isTimeout) {
            console.warn('[notifications] Lista indisponível (rede lenta); usando notificações locais se houver.');
          } else {
            console.error('Get notifications Supabase failed:', msg);
          }
        }
      }
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw).map((n: any) => ({
        ...n,
        createdAt: new Date(n.createdAt),
        status: n.status ?? (n.read ? 'read' : 'pending'),
      })) as InAppNotification[];
      return parsed.filter(
        (n) => n.userId === userId && !n.read,
      );
    } catch {
      return [];
    }
  },

  async getUnreadCount(userId: string): Promise<number> {
    const all = await this.getAll(userId);
    // Conta apenas pending (não lidas e não resolvidas)
    return all.filter((n) => n.status === 'pending').length;
  },

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    // Atualizar localStorage primeiro (sempre funciona)
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // REMOVER completamente a notificação, não apenas marcar como lida
        const updated = parsed.filter((n: any) => n.id !== notificationId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        console.log('Notificação removida do localStorage:', notificationId);
      }
    } catch (e) {
      console.error('localStorage update failed:', e);
    }

    // Tentar atualizar no Supabase (background, não bloqueia)
    if (isSupabaseConfigured && supabase) {
      try {
        // Tentar usar RPC primeiro
        await supabase.rpc('mark_notification_read', {
          p_notification_id: notificationId,
          p_user_id: userId,
        });
      } catch (rpcError) {
        try {
          // Fallback para update direto
          await supabase
            .from('notifications')
            .update({ read: true })
            .eq('id', notificationId)
            .eq('user_id', userId);
        } catch (updateError) {
          console.error('Mark read failed:', updateError);
        }
      }
    }
  },

  async markAllAsRead(userId: string): Promise<void> {
    const all = await this.getAll(userId);
    for (const n of all) {
      if (n.status === 'pending') await this.markAsRead(userId, n.id);
    }
  },

  /**
   * Marca notificações de um colaborador como resolvidas quando o admin responde.
   * Filtra por metadata.requestId ou metadata.adjustmentId para precisão.
   */
  async resolveByReference(
    userId: string,
    referenceId: string,
    referenceType: 'request' | 'adjustment',
  ): Promise<void> {
    const all = await this.getAll(userId, true);
    const metaKey = referenceType === 'request' ? 'requestId' : 'adjustmentId';
    const targets = all.filter(
      (n) => n.metadata?.[metaKey] === referenceId && n.status !== 'resolved',
    );

    for (const n of targets) {
      await this.markAsResolved(userId, n.id);
    }
  },

  async markAsResolved(userId: string, notificationId: string): Promise<void> {
    // Atualizar localStorage primeiro (sempre funciona)
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // REMOVER completamente a notificação, não apenas marcar como resolvida
        const updated = parsed.filter((n: any) => n.id !== notificationId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        console.log('Notificação removida do localStorage:', notificationId);
      }
    } catch (e) {
      console.error('localStorage update failed:', e);
    }

    // Tentar atualizar no Supabase (background, não bloqueia)
    if (isSupabaseConfigured && supabase) {
      try {
        // Tentar usar RPC de delete
        await supabase.rpc('delete_notification', {
          p_notification_id: notificationId,
          p_user_id: userId,
        });
      } catch (rpcError) {
        try {
          // Fallback para update direto
          await supabase
            .from('notifications')
            .update({ read: true })
            .eq('id', notificationId)
            .eq('user_id', userId);
        } catch (updateError) {
          console.error('Delete notification failed:', updateError);
        }
      }
    }
  },
};
