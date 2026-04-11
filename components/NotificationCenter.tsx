import React, { useState, useEffect, useCallback } from 'react';
import { InAppNotification } from '../types';
import { NotificationService } from '../services/notificationService';
import { Bell, Check, X, AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from './UI';

interface NotificationCenterProps {
  userId: string;
  onClose?: () => void;
  /** Chamado sempre que o contador de não lidas muda — permite atualizar o sino no header */
  onUnreadCountChange?: (count: number) => void;
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({ userId, onClose, onUnreadCountChange }) => {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    const all = await NotificationService.getAll(userId);
    setNotifications(all);
    const pending = all.filter((n) => n.status === 'pending').length;
    setUnreadCount(pending);
    onUnreadCountChange?.(pending);
    setIsLoading(false);
  }, [userId, onUnreadCountChange]);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const handleMarkAsRead = async (id: string) => {
    await NotificationService.markAsRead(userId, id);
    await loadNotifications();
  };

  const handleDeleteNotification = async (id: string) => {
    try {
      console.log('Deletando notificação:', id);
      await NotificationService.markAsRead(userId, id);
      console.log('Notificação deletada, recarregando lista...');
      await loadNotifications();
      console.log('Lista recarregada');
    } catch (e) {
      console.error('Erro ao deletar notificação:', e);
    }
  };

  const handleMarkAllAsRead = async () => {
    await NotificationService.markAllAsRead(userId);
    await loadNotifications();
  };

  const getIcon = (type: InAppNotification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-600" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Info className="w-5 h-5 text-blue-600" />;
    }
  };

  const getStatusBadge = (notif: InAppNotification) => {
    if (notif.status === 'resolved') {
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium">
          Resolvida
        </span>
      );
    }
    if (notif.status === 'read') {
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-medium">
          Lida
        </span>
      );
    }
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium">
        Nova
      </span>
    );
  };

  return (
    <div className="glass-card rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg" role="dialog" aria-label="Centro de notificações">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-indigo-600" />
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Notificações</h2>
          {unreadCount > 0 && (
            <span className="px-2 py-1 bg-indigo-600 text-white text-xs font-bold rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllAsRead}
              aria-label="Marcar todas como lidas"
            >
              <Check className="w-4 h-4" /> Marcar todas
            </Button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              aria-label="Fechar notificações"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
        {isLoading ? (
          <div className="text-center py-8 text-slate-400">Carregando...</div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Nenhuma notificação</p>
          </div>
        ) : (
          notifications.map((notif) => (
            <div
              key={notif.id}
              className={`p-4 rounded-xl border transition-all ${
                notif.status === 'pending'
                  ? 'bg-white dark:bg-slate-800 border-indigo-200 dark:border-indigo-900 shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-75'
              }`}
              role="article"
              aria-label={`Notificação: ${notif.title}`}
            >
              <div className="flex items-start gap-3">
                {getIcon(notif.type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900 dark:text-white text-sm">
                          {notif.title}
                        </h3>
                        {getStatusBadge(notif)}
                      </div>
                      <p className="text-slate-600 dark:text-slate-400 text-xs mt-1">
                        {notif.message}
                      </p>
                      <p className="text-slate-400 dark:text-slate-500 text-[10px] mt-2">
                        {new Date(notif.createdAt).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {notif.status === 'pending' && (
                        <button
                          onClick={() => handleMarkAsRead(notif.id)}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
                          aria-label={`Marcar como lida: ${notif.title}`}
                          title="Marcar como lida"
                        >
                          <Check className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteNotification(notif.id)}
                        className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                        aria-label={`Excluir notificação: ${notif.title}`}
                        title="Excluir"
                      >
                        <X className="w-4 h-4 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400" />
                      </button>
                    </div>
                  </div>
                  {notif.actionUrl && (
                    <a
                      href={notif.actionUrl}
                      className="text-indigo-600 dark:text-indigo-400 text-xs font-medium mt-2 inline-block hover:underline"
                    >
                      Ver detalhes →
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default NotificationCenter;
