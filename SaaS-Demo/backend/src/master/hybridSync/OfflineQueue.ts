/**
 * OfflineQueue — fila de operações geradas offline (aguardando sync).
 * Independente da SyncQueue (push local → cloud quando online).
 */
import { randomUUID } from 'node:crypto';
import type { SyncEntityType, SyncPayload } from './hybridSync.types.js';

export type OfflineQueueItemStatus = 'queued' | 'flushed' | 'failed';

export type OfflineQueueItem = {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: 'upsert' | 'delete' | 'patch';
  payload: SyncPayload;
  status: OfflineQueueItemStatus;
  createdAt: string;
  flushedAt: string | null;
  lastError: string | null;
};

export type EnqueueOfflineInput = {
  entityType: SyncEntityType;
  entityId: string;
  operation?: 'upsert' | 'delete' | 'patch';
  payload: SyncPayload;
};

export class OfflineQueue {
  private readonly items = new Map<string, OfflineQueueItem>();

  enqueue(input: EnqueueOfflineInput): OfflineQueueItem {
    const item: OfflineQueueItem = {
      id: `off_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation ?? 'upsert',
      payload: { ...input.payload },
      status: 'queued',
      createdAt: new Date().toISOString(),
      flushedAt: null,
      lastError: null,
    };
    this.items.set(item.id, item);
    return this.clone(item);
  }

  peekQueued(limit = 50): OfflineQueueItem[] {
    return [...this.items.values()]
      .filter((i) => i.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(1, limit))
      .map((i) => this.clone(i));
  }

  markFlushed(id: string): OfflineQueueItem | null {
    const current = this.items.get(id);
    if (!current) return null;
    const next: OfflineQueueItem = {
      ...current,
      status: 'flushed',
      flushedAt: new Date().toISOString(),
      lastError: null,
    };
    this.items.set(id, next);
    return this.clone(next);
  }

  markFailed(id: string, error: string): OfflineQueueItem | null {
    const current = this.items.get(id);
    if (!current) return null;
    const next: OfflineQueueItem = {
      ...current,
      status: 'failed',
      lastError: error,
    };
    this.items.set(id, next);
    return this.clone(next);
  }

  list(): OfflineQueueItem[] {
    return [...this.items.values()].map((i) => this.clone(i));
  }

  size(): number {
    return this.items.size;
  }

  pendingCount(): number {
    return [...this.items.values()].filter((i) => i.status === 'queued').length;
  }

  clear(): void {
    this.items.clear();
  }

  private clone(item: OfflineQueueItem): OfflineQueueItem {
    return { ...item, payload: { ...item.payload } };
  }
}
