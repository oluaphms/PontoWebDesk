/**
 * Sessão Master — registro server-side (revogação / refresh / limites).
 * Isolada da sessão operacional das empresas.
 */
export type MasterSessionRecord = {
  id: string;
  userId: string;
  /** jti do access token atual. */
  jti: string;
  /** Família de refresh (detecção de reuse). */
  refreshFamilyId: string;
  /** Hash SHA-256 do refresh token atual. */
  refreshTokenHash: string;
  /** Refresh tokens já usados nesta família (anti-replay). */
  usedRefreshHashes: string[];
  device: string | null;
  ip: string | null;
  issuedAt: string;
  lastActivityAt: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
};

export type CreateMasterSessionInput = {
  userId: string;
  jti: string;
  refreshFamilyId: string;
  refreshTokenHash: string;
  device?: string | null;
  ip?: string | null;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export interface MasterSessionStore {
  save(row: MasterSessionRecord): Promise<MasterSessionRecord>;
  findById(id: string): Promise<MasterSessionRecord | null>;
  findByJti(jti: string): Promise<MasterSessionRecord | null>;
  findByRefreshHash(hash: string): Promise<MasterSessionRecord | null>;
  listByUser(userId: string): Promise<MasterSessionRecord[]>;
  listActiveByUser(userId: string): Promise<MasterSessionRecord[]>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}
