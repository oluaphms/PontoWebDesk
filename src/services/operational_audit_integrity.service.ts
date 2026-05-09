import SHA256 from 'crypto-js/sha256';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';

export type OperationalAuditIntegrityInput = {
  companyId: string;
  employeeId?: string | null;
  correlationId: string;
  source: string;
  sequence: number;
  payload: Record<string, unknown>;
  previousHash?: string | null;
  replayLineage?: string[] | null;
};

export type OperationalAuditIntegrityResult = {
  hash: string;
  checksum: string;
  chainHash: string;
};

function stableStringify(data: unknown): string {
  if (data == null || typeof data !== 'object') return JSON.stringify(data);
  if (Array.isArray(data)) return `[${data.map((x) => stableStringify(x)).join(',')}]`;
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function buildOperationalAuditIntegrity(input: OperationalAuditIntegrityInput): OperationalAuditIntegrityResult {
  const serializedPayload = stableStringify(input.payload);
  const hash = SHA256(serializedPayload).toString();
  const checksum = SHA256(`${input.companyId}|${input.employeeId ?? ''}|${input.sequence}|${hash}`).toString();
  const chainHash = SHA256(`${input.previousHash ?? 'root'}|${input.correlationId}|${checksum}`).toString();
  return { hash, checksum, chainHash };
}

export async function verifyAndPersistOperationalLegalIntegrity(
  input: OperationalAuditIntegrityInput,
  clientOverride?: SupabaseClient | null,
): Promise<{ ok: boolean; result?: OperationalAuditIntegrityResult; error?: string }> {
  const client = clientOverride ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'no_client' };
  const computed = buildOperationalAuditIntegrity(input);
  const { error } = await client.from('operational_legal_audit_trail').insert({
    company_id: input.companyId,
    actor_id: input.employeeId ?? null,
    action: 'operational_integrity_checkpoint',
    source: input.source,
    correlation_id: input.correlationId,
    payload_after: {
      integrity_hash: computed.hash,
      geo_checksum: computed.checksum,
      sequence_signature: input.sequence,
      integrity_lineage: computed.chainHash,
      replay_lineage: input.replayLineage ?? [],
      payload: input.payload,
    },
  });
  if (error) {
    console.error('[LEGAL INTEGRITY VIOLATION]', {
      company_id: input.companyId,
      correlation_id: input.correlationId,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }
  console.info('[LEGAL INTEGRITY VERIFIED]', {
    company_id: input.companyId,
    correlation_id: input.correlationId,
    chain_hash: computed.chainHash,
  });
  return { ok: true, result: computed };
}

