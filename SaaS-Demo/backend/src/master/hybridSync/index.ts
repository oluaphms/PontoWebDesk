/**
 * Hybrid Sync — infraestrutura LOCAL + CLOUD.
 * Sem alterar módulos existentes. Sem frontend. Sem HTTP obrigatório.
 */
export type {
  SyncDirection,
  SyncEntityType,
  SyncItemStatus,
  SyncSide,
  SyncPayload,
  SyncItem,
  ConflictStrategy,
  ConflictRecord,
  SyncResult,
  EnqueueSyncInput,
} from './hybridSync.types.js';

export { SyncQueue } from './SyncQueue.js';
export { OfflineQueue, type OfflineQueueItem, type EnqueueOfflineInput } from './OfflineQueue.js';
export { ConflictResolver } from './ConflictResolver.js';
export { LocalSyncService } from './LocalSyncService.js';
export { CloudSyncService } from './CloudSyncService.js';
export { createHybridSync, type HybridSyncServices, type CreateHybridSyncOptions } from './createHybridSync.js';
