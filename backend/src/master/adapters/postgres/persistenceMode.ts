/**
 * Configuração de persistência do Painel Master.
 * - MASTER_PERSISTENCE=postgres|pg → postgres
 * - MASTER_PERSISTENCE=memory → memory (testes / demos explícitos)
 * - Ausente:
 *   - production → postgres (fail-closed)
 *   - test → memory
 *   - development com DATABASE_URL → postgres (evita fallback silencioso)
 *   - demais → memory
 */
export type MasterPersistenceMode = 'memory' | 'postgres';

export function resolveMasterPersistenceMode(
  env: NodeJS.ProcessEnv = process.env,
): MasterPersistenceMode {
  const raw = String(env.MASTER_PERSISTENCE || '')
    .trim()
    .toLowerCase();
  if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') return 'postgres';
  if (raw === 'memory') return 'memory';
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') return 'postgres';
  if (nodeEnv === 'test') return 'memory';
  const hasDatabaseUrl = Boolean(String(env.DATABASE_URL || '').trim());
  if (hasDatabaseUrl && (nodeEnv === 'development' || nodeEnv === '')) {
    return 'postgres';
  }
  return 'memory';
}

export function isMasterPostgresPersistence(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveMasterPersistenceMode(env) === 'postgres';
}
