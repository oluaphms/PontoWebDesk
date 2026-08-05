import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pool } from '../db/index.js';

export type UpdateAgentIdentity = {
  tokenId: string;
  installationId: string;
};

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(String(token || '').trim()).digest('hex');
}

/** Token de alta entropia — mostrado uma única vez ao operador. */
export function generateAgentToken(): string {
  return `uag_${randomBytes(24).toString('hex')}`;
}

function tokenId(): string {
  return `uat_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * Emite um token para uma instalação. Retorna o texto puro apenas uma vez.
 * Revoga tokens ativos anteriores da mesma instalação (rotação).
 */
export async function issueAgentToken(
  installationId: string,
  createdBy?: string | null,
): Promise<{ token: string; tokenId: string }> {
  const token = generateAgentToken();
  const hash = hashAgentToken(token);
  const id = tokenId();
  await pool.queryMaster(
    `update public.master_update_agent_tokens
        set status = 'revoked', revoked_at = now()
      where installation_id = $1 and status = 'active'`,
    [installationId],
  );
  await pool.queryMaster(
    `insert into public.master_update_agent_tokens (id, installation_id, token_hash, created_by)
     values ($1,$2,$3,$4)`,
    [id, installationId, hash, createdBy ?? null],
  );
  return { token, tokenId: id };
}

/**
 * Autentica um token de agente por hash. Deriva a instalação do servidor,
 * nunca do payload. Atualiza last_used_at em caso de sucesso.
 */
export async function authenticateAgentToken(
  presented: string,
): Promise<UpdateAgentIdentity | null> {
  const token = String(presented || '').trim();
  if (!token.startsWith('uag_')) return null;
  const hash = hashAgentToken(token);
  const result = await pool.queryMaster<{ id: string; installation_id: string; token_hash: string }>(
    `select id, installation_id, token_hash
       from public.master_update_agent_tokens
      where status = 'active'
        and token_hash = $1
      limit 1`,
    [hash],
  );
  const row = result.rows[0];
  if (!row) return null;
  // Defesa extra: comparação em tempo constante do hash.
  const a = Buffer.from(hash);
  const b = Buffer.from(String(row.token_hash));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await pool.queryMaster(
    `update public.master_update_agent_tokens set last_used_at = now() where id = $1`,
    [row.id],
  );
  return { tokenId: row.id, installationId: row.installation_id };
}
