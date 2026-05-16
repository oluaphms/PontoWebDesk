import type { SupabaseClient } from '@supabase/supabase-js';

export type OperationalAuditEntityType = 'task' | 'alert' | 'risk';

export type LogAuditParams = {
  supabase: SupabaseClient;
  companyId: string;
  actorId: string | null | undefined;
  entityType: OperationalAuditEntityType;
  entityId: string | null | undefined;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export async function logAudit({
  supabase,
  companyId,
  actorId,
  entityType,
  entityId,
  action,
  before,
  after,
  metadata,
}: LogAuditParams): Promise<void> {
  const cid = companyId.trim();
  if (!cid) return;

  try {
    const { error } = await supabase.from('operational_audit_log').insert({
      company_id: cid,
      actor_id: actorId || null,
      entity_type: entityType,
      entity_id: entityId || null,
      action,
      before: before ?? null,
      after: after ?? null,
      metadata: metadata ?? null,
    });

    if (error) {
      console.error('[AUDIT LOG ERROR]', error);
    }
  } catch (err) {
    console.error('[AUDIT LOG ERROR]', err);
  }
}
