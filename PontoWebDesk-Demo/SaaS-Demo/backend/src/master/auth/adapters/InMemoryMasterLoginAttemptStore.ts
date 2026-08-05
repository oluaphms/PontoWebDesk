/**
 * Store InMemory de tentativas de login Master — default (testes / sem PG).
 * Mantém um buffer limitado por processo.
 */
import { randomUUID } from 'node:crypto';
import type {
  MasterLoginAttempt,
  MasterLoginAttemptRecord,
  MasterLoginAttemptStore,
} from '../ports/MasterLoginAttemptStore.js';

const MAX_BUFFER = 500;

export class InMemoryMasterLoginAttemptStore implements MasterLoginAttemptStore {
  private readonly buffer: MasterLoginAttemptRecord[] = [];

  async record(attempt: MasterLoginAttempt): Promise<void> {
    this.buffer.push({
      id: randomUUID(),
      email: String(attempt.email || '').trim().toLowerCase(),
      userId: attempt.userId ?? null,
      success: attempt.success,
      reason: attempt.reason ?? null,
      ip: attempt.ip ?? null,
      device: attempt.device ?? null,
      createdAt: new Date().toISOString(),
    });
    while (this.buffer.length > MAX_BUFFER) this.buffer.shift();
  }

  async recentByEmail(email: string, limit = 20): Promise<MasterLoginAttemptRecord[]> {
    const needle = email.trim().toLowerCase();
    return this.buffer
      .filter((a) => a.email === needle)
      .slice(-limit)
      .reverse();
  }
}
