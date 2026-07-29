/**
 * Composition root — Hybrid Sync (infraestrutura in-memory).
 * Não altera módulos existentes de ponto/REP/auth.
 */
import { CloudSyncService } from './CloudSyncService.js';
import { ConflictResolver } from './ConflictResolver.js';
import { LocalSyncService } from './LocalSyncService.js';
import { OfflineQueue } from './OfflineQueue.js';
import { SyncQueue } from './SyncQueue.js';
import type { ConflictStrategy } from './hybridSync.types.js';

export type HybridSyncServices = {
  syncQueue: SyncQueue;
  offlineQueue: OfflineQueue;
  conflicts: ConflictResolver;
  localSync: LocalSyncService;
  cloudSync: CloudSyncService;
};

export type CreateHybridSyncOptions = {
  defaultConflictStrategy?: ConflictStrategy;
};

export function createHybridSync(opts: CreateHybridSyncOptions = {}): HybridSyncServices {
  const syncQueue = new SyncQueue();
  const offlineQueue = new OfflineQueue();
  const conflicts = new ConflictResolver();
  const localSync = new LocalSyncService({ syncQueue, offlineQueue, conflicts });
  const cloudSync = new CloudSyncService({
    syncQueue,
    conflicts,
    defaultConflictStrategy: opts.defaultConflictStrategy ?? 'latest_wins',
  });

  return {
    syncQueue,
    offlineQueue,
    conflicts,
    localSync,
    cloudSync,
  };
}
