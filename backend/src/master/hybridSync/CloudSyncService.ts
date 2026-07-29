/**
 * CloudSyncService — sincronização a partir da nuvem (HYBRID).
 * Infraestrutura: pull/push simulados + detecção de conflito.
 * Sem alterar módulos existentes. Sem gateway HTTP obrigatório.
 */
import type { ConflictResolver } from './ConflictResolver.js';
import type { SyncQueue } from './SyncQueue.js';
import type {
  ConflictStrategy,
  EnqueueSyncInput,
  SyncItem,
  SyncResult,
} from './hybridSync.types.js';

export type CloudSyncServiceDeps = {
  syncQueue: SyncQueue;
  conflicts: ConflictResolver;
  /** Estratégia padrão de conflito. */
  defaultConflictStrategy?: ConflictStrategy;
};

export class CloudSyncService {
  constructor(private readonly deps: CloudSyncServiceDeps) {}

  /** Enfileira item originado na cloud. */
  enqueueCloud(input: Omit<EnqueueSyncInput, 'side'> & { side?: 'cloud' }): SyncItem {
    return this.deps.syncQueue.enqueue({
      ...input,
      side: 'cloud',
      direction: input.direction ?? 'pull',
    });
  }

  /**
   * Pull simulado: processa itens cloud pendentes e detecta conflito
   * contra versões locais na mesma SyncQueue.
   */
  async pullPending(limit = 50): Promise<SyncResult> {
    const pending = this.deps.syncQueue
      .peekPending(limit)
      .filter((i) => i.side === 'cloud' && (i.direction === 'pull' || i.direction === 'bidirectional'));

    let pulled = 0;
    let conflicts = 0;
    let failed = 0;
    const strategy = this.deps.defaultConflictStrategy ?? 'latest_wins';

    for (const cloudItem of pending) {
      this.deps.syncQueue.mark(cloudItem.id, 'processing');
      try {
        const localMatch = this.deps.syncQueue
          .list()
          .find(
            (i) =>
              i.side === 'local' &&
              i.entityType === cloudItem.entityType &&
              i.entityId === cloudItem.entityId &&
              i.id !== cloudItem.id,
          );

        if (localMatch && this.deps.conflicts.detect(localMatch, cloudItem)) {
          const { conflict } = this.deps.conflicts.resolvePair({
            local: localMatch,
            cloud: cloudItem,
            strategy,
          });
          this.deps.syncQueue.mark(cloudItem.id, 'conflict');
          this.deps.syncQueue.mark(localMatch.id, 'conflict');
          conflicts += 1;
          void conflict;
        } else {
          this.deps.syncQueue.mark(cloudItem.id, 'synced');
          pulled += 1;
        }
      } catch (e) {
        this.deps.syncQueue.mark(
          cloudItem.id,
          'failed',
          e instanceof Error ? e.message : String(e),
        );
        failed += 1;
      }
    }

    return {
      ok: failed === 0,
      pushed: 0,
      pulled,
      conflicts,
      failed,
      message: 'cloud_sync_infrastructure_only',
    };
  }

  async pushAndPull(limit = 50): Promise<SyncResult> {
    const pull = await this.pullPending(limit);
    return {
      ...pull,
      message: 'cloud_sync_pull_only_in_this_service',
    };
  }
}
