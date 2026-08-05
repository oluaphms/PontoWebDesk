/**
 * LocalSyncService — sincronização a partir do nó local (HYBRID).
 * Infraestrutura: enfileira e processa fila local → sync queue.
 * Sem alterar módulos de ponto/REP existentes.
 */
import type { ConflictResolver } from './ConflictResolver.js';
import type { EnqueueOfflineInput, OfflineQueue } from './OfflineQueue.js';
import type { SyncQueue } from './SyncQueue.js';
import type { EnqueueSyncInput, SyncResult } from './hybridSync.types.js';

export type LocalSyncServiceDeps = {
  syncQueue: SyncQueue;
  offlineQueue: OfflineQueue;
  conflicts: ConflictResolver;
};

export class LocalSyncService {
  constructor(private readonly deps: LocalSyncServiceDeps) {}

  /** Registra mudança local offline. */
  enqueueOffline(input: EnqueueOfflineInput) {
    return this.deps.offlineQueue.enqueue(input);
  }

  /** Promove itens offline → SyncQueue (lado local). */
  flushOfflineToSyncQueue(limit = 50): number {
    const pending = this.deps.offlineQueue.peekQueued(limit);
    let n = 0;
    for (const item of pending) {
      const syncInput: EnqueueSyncInput = {
        entityType: item.entityType,
        entityId: item.entityId,
        side: 'local',
        direction: 'push',
        payload: item.payload,
        meta: { offlineId: item.id, operation: item.operation },
      };
      this.deps.syncQueue.enqueue(syncInput);
      this.deps.offlineQueue.markFlushed(item.id);
      n += 1;
    }
    return n;
  }

  /** Processa push local (simulado — sem HTTP). */
  async pushPending(limit = 50): Promise<SyncResult> {
    this.flushOfflineToSyncQueue(limit);
    const pending = this.deps.syncQueue
      .peekPending(limit)
      .filter((i) => i.side === 'local' && (i.direction === 'push' || i.direction === 'bidirectional'));

    let pushed = 0;
    let failed = 0;
    for (const item of pending) {
      this.deps.syncQueue.mark(item.id, 'processing');
      try {
        this.deps.syncQueue.mark(item.id, 'synced');
        pushed += 1;
      } catch (e) {
        this.deps.syncQueue.mark(item.id, 'failed', e instanceof Error ? e.message : String(e));
        failed += 1;
      }
    }

    return {
      ok: failed === 0,
      pushed,
      pulled: 0,
      conflicts: 0,
      failed,
      message: 'local_sync_infrastructure_only',
    };
  }

  getOfflinePendingCount(): number {
    return this.deps.offlineQueue.pendingCount();
  }
}
