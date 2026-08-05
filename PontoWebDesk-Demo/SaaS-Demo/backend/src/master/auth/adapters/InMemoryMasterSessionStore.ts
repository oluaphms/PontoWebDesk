/**
 * Store InMemory de sessões Master — default para testes / sem PG.
 */
import type {
  MasterSessionRecord,
  MasterSessionStore,
} from '../ports/MasterSessionStore.js';

export class InMemoryMasterSessionStore implements MasterSessionStore {
  private readonly byId = new Map<string, MasterSessionRecord>();

  async save(row: MasterSessionRecord): Promise<MasterSessionRecord> {
    const next: MasterSessionRecord = {
      ...row,
      usedRefreshHashes: [...row.usedRefreshHashes],
    };
    this.byId.set(next.id, next);
    return {
      ...next,
      usedRefreshHashes: [...next.usedRefreshHashes],
    };
  }

  async findById(id: string): Promise<MasterSessionRecord | null> {
    const row = this.byId.get(id);
    return row ? { ...row, usedRefreshHashes: [...row.usedRefreshHashes] } : null;
  }

  async findByJti(jti: string): Promise<MasterSessionRecord | null> {
    for (const row of this.byId.values()) {
      if (row.jti === jti) {
        return { ...row, usedRefreshHashes: [...row.usedRefreshHashes] };
      }
    }
    return null;
  }

  async findByRefreshHash(hash: string): Promise<MasterSessionRecord | null> {
    for (const row of this.byId.values()) {
      if (row.refreshTokenHash === hash) {
        return { ...row, usedRefreshHashes: [...row.usedRefreshHashes] };
      }
      if (row.usedRefreshHashes.includes(hash)) {
        return { ...row, usedRefreshHashes: [...row.usedRefreshHashes] };
      }
    }
    return null;
  }

  async listByUser(userId: string): Promise<MasterSessionRecord[]> {
    return [...this.byId.values()]
      .filter((r) => r.userId === userId)
      .map((r) => ({ ...r, usedRefreshHashes: [...r.usedRefreshHashes] }))
      .sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));
  }

  async listActiveByUser(userId: string): Promise<MasterSessionRecord[]> {
    const now = Date.now();
    return (await this.listByUser(userId)).filter(
      (r) => !r.revokedAt && Date.parse(r.refreshExpiresAt) > now,
    );
  }

  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }

  async clear(): Promise<void> {
    this.byId.clear();
  }
}
