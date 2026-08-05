/**
 * ConflictResolver — resolve conflitos local vs cloud (infraestrutura).
 * Sem alterar regras de domínio de ponto/REP.
 */
import { randomUUID } from 'node:crypto';
import type {
  ConflictRecord,
  ConflictStrategy,
  SyncItem,
  SyncSide,
} from './hybridSync.types.js';

export type ResolveConflictInput = {
  local: SyncItem;
  cloud: SyncItem;
  strategy?: ConflictStrategy;
};

export class ConflictResolver {
  private readonly conflicts = new Map<string, ConflictRecord>();

  detect(local: SyncItem, cloud: SyncItem): boolean {
    if (local.entityType !== cloud.entityType || local.entityId !== cloud.entityId) {
      return false;
    }
    if (local.version !== cloud.version) return true;
    return JSON.stringify(local.payload) !== JSON.stringify(cloud.payload);
  }

  register(input: ResolveConflictInput): ConflictRecord {
    const strategy = input.strategy ?? 'latest_wins';
    const record: ConflictRecord = {
      id: `cnf_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      entityType: input.local.entityType,
      entityId: input.local.entityId,
      local: { ...input.local, payload: { ...input.local.payload } },
      cloud: { ...input.cloud, payload: { ...input.cloud.payload } },
      strategy,
      resolved: false,
      winner: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.conflicts.set(record.id, record);
    return this.clone(record);
  }

  resolve(conflictId: string, strategy?: ConflictStrategy): ConflictRecord {
    const current = this.conflicts.get(conflictId);
    if (!current) {
      throw new Error(`conflict not found: ${conflictId}`);
    }
    const used = strategy ?? current.strategy;
    const winner = this.pickWinner(current.local, current.cloud, used);
    const next: ConflictRecord = {
      ...current,
      strategy: used,
      resolved: true,
      winner,
      resolvedAt: new Date().toISOString(),
    };
    this.conflicts.set(conflictId, next);
    return this.clone(next);
  }

  /** Resolve imediatamente a partir de dois itens. */
  resolvePair(input: ResolveConflictInput): { conflict: ConflictRecord; winner: SyncSide } {
    const registered = this.register(input);
    const resolved = this.resolve(registered.id, input.strategy);
    return { conflict: resolved, winner: resolved.winner ?? 'local' };
  }

  list(unresolvedOnly = false): ConflictRecord[] {
    return [...this.conflicts.values()]
      .filter((c) => (unresolvedOnly ? !c.resolved : true))
      .map((c) => this.clone(c));
  }

  private pickWinner(local: SyncItem, cloud: SyncItem, strategy: ConflictStrategy): SyncSide {
    switch (strategy) {
      case 'local_wins':
        return 'local';
      case 'cloud_wins':
        return 'cloud';
      case 'manual':
        return 'local'; // placeholder até UI decidir
      case 'latest_wins':
      default: {
        const lt = Date.parse(local.updatedAt);
        const ct = Date.parse(cloud.updatedAt);
        if (Number.isFinite(lt) && Number.isFinite(ct)) {
          return lt >= ct ? 'local' : 'cloud';
        }
        return local.version >= cloud.version ? 'local' : 'cloud';
      }
    }
  }

  private clone(record: ConflictRecord): ConflictRecord {
    return {
      ...record,
      local: { ...record.local, payload: { ...record.local.payload } },
      cloud: { ...record.cloud, payload: { ...record.cloud.payload } },
    };
  }
}
