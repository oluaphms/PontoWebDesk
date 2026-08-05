import type { MasterUser } from '../masterAuth.types.js';
import type { MasterUserStore } from '../ports/MasterUserStore.js';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class InMemoryMasterUserStore implements MasterUserStore {
  private readonly byId = new Map<string, MasterUser>();

  async save(user: MasterUser): Promise<MasterUser> {
    const copy = clone({
      ...user,
      isFounder: user.isFounder === true,
    });
    // Flag Founder é sticky no store in-memory (espelha o trigger PG).
    const previous = this.byId.get(copy.id);
    if (previous?.isFounder) {
      copy.isFounder = true;
      copy.active = true;
    }
    this.byId.set(copy.id, copy);
    return clone(copy);
  }

  async findById(id: string): Promise<MasterUser | null> {
    const row = this.byId.get(id);
    return row ? clone(row) : null;
  }

  async findByEmail(email: string): Promise<MasterUser | null> {
    const needle = email.trim().toLowerCase();
    for (const row of this.byId.values()) {
      if (row.email === needle) return clone(row);
    }
    return null;
  }

  async list(): Promise<MasterUser[]> {
    return [...this.byId.values()].map((u) => clone(u));
  }

  async delete(id: string): Promise<boolean> {
    const row = this.byId.get(id);
    if (row?.isFounder) return false;
    return this.byId.delete(id);
  }
}
