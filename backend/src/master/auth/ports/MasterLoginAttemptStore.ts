/**
 * Registro de tentativas de login Master (auditoria de segurança).
 * Isolado do login operacional das empresas.
 */
export type MasterLoginAttempt = {
  email: string;
  userId?: string | null;
  success: boolean;
  reason?: string | null;
  ip?: string | null;
  device?: string | null;
};

export type MasterLoginAttemptRecord = MasterLoginAttempt & {
  id: string;
  createdAt: string;
};

export interface MasterLoginAttemptStore {
  record(attempt: MasterLoginAttempt): Promise<void>;
  recentByEmail(email: string, limit?: number): Promise<MasterLoginAttemptRecord[]>;
}
