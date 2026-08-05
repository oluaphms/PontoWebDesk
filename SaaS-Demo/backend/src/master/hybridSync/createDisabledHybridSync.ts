/**
 * HybridSync desabilitado — usado quando MASTER_PERSISTENCE=postgres.
 * Não mantém filas em memória; mutações falham de forma explícita.
 */
import { MasterError } from '../errors.js';
import { CloudSyncService } from './CloudSyncService.js';
import { ConflictResolver } from './ConflictResolver.js';
import { LocalSyncService } from './LocalSyncService.js';
import { OfflineQueue } from './OfflineQueue.js';
import { SyncQueue } from './SyncQueue.js';
import type { HybridSyncServices } from './createHybridSync.js';

function disabled(op: string): never {
  throw new MasterError(
    'MASTER_DISABLED',
    `HybridSync desabilitado com MASTER_PERSISTENCE=postgres (${op}). Sem backend em memória.`,
  );
}

class DisabledSyncQueue extends SyncQueue {
  override enqueue(): never {
    return disabled('syncQueue.enqueue');
  }
  override mark(): never {
    return disabled('syncQueue.mark');
  }
  override clear(): void {
    /* no-op — sem estado */
  }
}

class DisabledOfflineQueue extends OfflineQueue {
  override enqueue(): never {
    return disabled('offlineQueue.enqueue');
  }
  override markFlushed(): never {
    return disabled('offlineQueue.markFlushed');
  }
  override markFailed(): never {
    return disabled('offlineQueue.markFailed');
  }
  override clear(): void {
    /* no-op */
  }
}

class DisabledConflictResolver extends ConflictResolver {
  override register(): never {
    return disabled('conflicts.register');
  }
  override resolve(): never {
    return disabled('conflicts.resolve');
  }
  override resolvePair(): never {
    return disabled('conflicts.resolvePair');
  }
}

/**
 * Solução adotada: DESABILITAR HybridSync em postgres.
 * Motivo: filas híbridas não fazem parte do Control Plane comercial Stable;
 * persistir PG exigiria schema/regras novas fora do escopo de hardening.
 */
export function createDisabledHybridSync(): HybridSyncServices {
  const syncQueue = new DisabledSyncQueue();
  const offlineQueue = new DisabledOfflineQueue();
  const conflicts = new DisabledConflictResolver();
  const localSync = new LocalSyncService({ syncQueue, offlineQueue, conflicts });
  const cloudSync = new CloudSyncService({
    syncQueue,
    conflicts,
    defaultConflictStrategy: 'latest_wins',
  });
  return {
    syncQueue,
    offlineQueue,
    conflicts,
    localSync,
    cloudSync,
  };
}
