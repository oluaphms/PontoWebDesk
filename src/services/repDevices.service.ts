import { db, getSupabaseClient } from '../../services/supabaseClient';

export type RepDeviceAuditAction = 'DELETE' | 'DEACTIVATE';

export type RepDeviceDeleteOutcome = 'deleted' | 'deactivated';

export type DeleteRepDeviceResult = {
  success: boolean;
  action: RepDeviceDeleteOutcome | 'none';
  message: string;
  error?: string;
};

export type DeleteRepDeviceOptions = {
  forceDelete?: boolean;
  companyId?: string;
  performedBy?: string | null;
  metadata?: Record<string, unknown>;
};

/** Decisão pura: usada em testes e no fluxo principal. */
export function resolveRepDeviceDeleteAction(
  hasHistory: boolean,
  forceDelete: boolean,
): 'delete' | 'deactivate' {
  if (forceDelete) return 'delete';
  if (hasHistory) return 'deactivate';
  return 'delete';
}

async function getAuthUserId(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

async function assertDeviceInCompany(deviceId: string, companyId?: string): Promise<{ company_id: string }> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase não inicializado');

  const { data, error } = await client
    .from('rep_devices')
    .select('id, company_id')
    .eq('id', deviceId)
    .maybeSingle();

  if (error) throw new Error(`Erro ao carregar dispositivo: ${error.message}`);
  if (!data) throw new Error('Dispositivo não encontrado');

  if (companyId && String(data.company_id) !== String(companyId)) {
    throw new Error('Dispositivo não pertence à empresa atual');
  }

  return { company_id: String(data.company_id) };
}

/**
 * Verifica existência de histórico com consulta mínima (LIMIT 1).
 */
export async function checkDeviceHistory(deviceId: string, companyId?: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase não inicializado');

  let query = client.from('rep_punch_logs').select('id').eq('rep_device_id', deviceId).limit(1);
  if (companyId) query = query.eq('company_id', companyId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Erro ao verificar histórico do relógio: ${error.message}`);
  return Boolean(data?.id);
}

/** Contagem para UX do modal (head/count indexado). */
export async function countDeviceHistoryRecords(deviceId: string, companyId?: string): Promise<number> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase não inicializado');

  let query = client
    .from('rep_punch_logs')
    .select('id', { count: 'exact', head: true })
    .eq('rep_device_id', deviceId);
  if (companyId) query = query.eq('company_id', companyId);

  const { count, error } = await query;
  if (error) throw new Error(`Erro ao contar histórico do relógio: ${error.message}`);
  return Number(count ?? 0);
}

async function writeRepDeviceAuditLog(input: {
  companyId: string;
  deviceId: string;
  action: RepDeviceAuditAction;
  performedBy: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client.from('rep_device_audit_logs').insert({
    company_id: input.companyId,
    device_id: input.deviceId,
    action: input.action,
    performed_by: input.performedBy,
    metadata: input.metadata ?? {},
  });

  if (error) {
    console.error('[rep_devices] Falha ao gravar auditoria:', error);
  }
}

export async function deactivateRepDevice(
  deviceId: string,
  options?: Pick<DeleteRepDeviceOptions, 'companyId' | 'performedBy' | 'metadata'>,
): Promise<DeleteRepDeviceResult> {
  const row = await assertDeviceInCompany(deviceId, options?.companyId);
  const performedBy = options?.performedBy ?? (await getAuthUserId());

  await db.update('rep_devices', deviceId, {
    ativo: false,
    status: 'inativo',
    updated_at: new Date().toISOString(),
  });

  await writeRepDeviceAuditLog({
    companyId: row.company_id,
    deviceId,
    action: 'DEACTIVATE',
    performedBy,
    metadata: options?.metadata,
  });

  return {
    success: true,
    action: 'deactivated',
    message: 'Dispositivo desativado pois possui histórico vinculado.',
  };
}

async function hardDeleteRepDevice(
  deviceId: string,
  options?: Pick<DeleteRepDeviceOptions, 'companyId' | 'performedBy' | 'metadata'>,
): Promise<DeleteRepDeviceResult> {
  const row = await assertDeviceInCompany(deviceId, options?.companyId);
  const performedBy = options?.performedBy ?? (await getAuthUserId());

  await db.delete('rep_devices', deviceId);

  await writeRepDeviceAuditLog({
    companyId: row.company_id,
    deviceId,
    action: 'DELETE',
    performedBy,
    metadata: options?.metadata,
  });

  return {
    success: true,
    action: 'deleted',
    message: 'Dispositivo removido.',
  };
}

/**
 * Exclusão segura (desativa se houver histórico) ou forçada (hard delete).
 * Em falha no delete, desativa como fallback — nunca deixa o fluxo quebrar.
 */
export async function deleteRepDevice(
  deviceId: string,
  options?: DeleteRepDeviceOptions,
): Promise<DeleteRepDeviceResult> {
  const forceDelete = options?.forceDelete === true;
  const metaBase = options?.metadata ?? {};

  try {
    const row = await assertDeviceInCompany(deviceId, options?.companyId);
    const hasHistory = await checkDeviceHistory(deviceId, row.company_id);
    const decision = resolveRepDeviceDeleteAction(hasHistory, forceDelete);

    if (decision === 'deactivate') {
      return deactivateRepDevice(deviceId, {
        companyId: row.company_id,
        performedBy: options?.performedBy,
        metadata: { ...metaBase, hasHistory: true, mode: 'safe' },
      });
    }

    return await hardDeleteRepDevice(deviceId, {
      companyId: row.company_id,
      performedBy: options?.performedBy,
      metadata: { ...metaBase, hasHistory, mode: forceDelete ? 'force' : 'no_history' },
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[rep_devices] Erro ao excluir dispositivo — tentando desativar:', e);

    try {
      const fallback = await deactivateRepDevice(deviceId, {
        companyId: options?.companyId,
        performedBy: options?.performedBy,
        metadata: { ...metaBase, fallback: true, deleteError: errMsg },
      });
      return {
        ...fallback,
        message:
          'Não foi possível excluir o dispositivo; ele foi desativado para proteger o histórico vinculado.',
        error: errMsg,
      };
    } catch (fallbackErr) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.error('[rep_devices] Fallback de desativação também falhou:', fallbackErr);
      return {
        success: false,
        action: 'none',
        message: 'Não foi possível excluir nem desativar o dispositivo.',
        error: `${errMsg} | fallback: ${fallbackMsg}`,
      };
    }
  }
}
