/**
 * Hybrid Sync — tipos da infraestrutura (sem alterar módulos de negócio).
 */

export type SyncDirection = 'push' | 'pull' | 'bidirectional';

export type SyncEntityType =
  | 'time_record'
  | 'employee'
  | 'rep_punch'
  | 'settings'
  | 'license'
  | 'generic';

export type SyncItemStatus =
  | 'pending'
  | 'processing'
  | 'synced'
  | 'conflict'
  | 'failed'
  | 'dropped';

export type SyncSide = 'local' | 'cloud';

export type SyncPayload = Readonly<Record<string, unknown>>;

export type SyncItem = {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  side: SyncSide;
  direction: SyncDirection;
  status: SyncItemStatus;
  payload: SyncPayload;
  version: number;
  updatedAt: string;
  createdAt: string;
  lastError?: string | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type ConflictStrategy =
  | 'local_wins'
  | 'cloud_wins'
  | 'latest_wins'
  | 'manual';

export type ConflictRecord = {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  local: SyncItem;
  cloud: SyncItem;
  strategy: ConflictStrategy;
  resolved: boolean;
  winner?: SyncSide | null;
  resolvedAt?: string | null;
  createdAt: string;
};

export type SyncResult = {
  ok: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  failed: number;
  message?: string;
};

export type EnqueueSyncInput = {
  entityType: SyncEntityType;
  entityId: string;
  side: SyncSide;
  direction?: SyncDirection;
  payload: SyncPayload;
  version?: number;
  meta?: Record<string, unknown>;
};
