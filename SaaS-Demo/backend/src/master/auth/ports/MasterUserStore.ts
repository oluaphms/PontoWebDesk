import type { MasterUser } from '../masterAuth.types.js';

export interface MasterUserStore {
  save(user: MasterUser): Promise<MasterUser>;
  findById(id: string): Promise<MasterUser | null>;
  findByEmail(email: string): Promise<MasterUser | null>;
  list(): Promise<MasterUser[]>;
  delete(id: string): Promise<boolean>;
}
