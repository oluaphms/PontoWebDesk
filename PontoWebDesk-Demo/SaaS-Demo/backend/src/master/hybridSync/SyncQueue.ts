/**
 * SyncQueue — fila de sincronização híbrida (in-memory).
 * Infraestrutura apenas; sem I/O de rede/banco de produto.
 */
import { randomUUID } from 'node:crypto';
import type { EnqueueSyncInput, SyncItem, SyncItemStatus } from './hybridSync.types.js';

function nowIso(): string {
  return new Date().toISOString();
}

export class SyncQueue {
  private readonly items = new Map<string, SyncItem>();

  enqueue(input: EnqueueSyncInput): SyncItem {
    const now = nowIso();
    const item: SyncItem = {
      id: `sync_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      entityType: input.entityType,
      entityId: input.entityId,
      side: input.side,
      direction: input.direction ?? 'bidirectional',
      status: 'pending',
      payload: { ...input.payload },
      version: input.version ?? 1,
      updatedAt: now,
      createdAt: now,
      lastError: null,
      meta: input.meta,
    };
    this.items.set(item.id, item);
    return this.clone(item);
  }

  peekPending(limit = 50): SyncItem[] {
    return [...this.items.values()]
      .filter((i) => i.status === 'pending')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(1, limit))
      .map((i) => this.clone(i));
  }

  mark(id: string, status: SyncItemStatus, lastError?: string | null): SyncItem | null {
    const current = this.items.get(id);
    if (!current) return null;
    const next: SyncItem = {
      ...current,
      status,
      lastError: lastError ?? null,
      updatedAt: nowIso(),
    };
    this.items.set(id, next);
    return this.clone(next);
  }

  get(id: string): SyncItem | null {
    const row = this.items.get(id);
    return row ? this.clone(row) : null;
  }

  list(): SyncItem[] {
    return [...this.items.values()].map((i) => this.clone(i));
  }

  size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  private clone(item: SyncItem): SyncItem {
    return {
      ...item,
      payload: { ...item.payload },
      meta: item.meta ? { ...item.meta } : undefined,
    };
  }
}
