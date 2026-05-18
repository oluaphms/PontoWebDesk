/**
 * Auditoria LGPD no cliente (visualização de dados sensíveis).
 */
import { useEffect } from 'react';
import { LogSeverity } from '../../types';
import { LoggingService } from '../../services/loggingService';
import { useAuth } from '@/hooks/useAuth';

export async function logViewSensitiveClient(input: {
  companyId: string;
  userId?: string;
  userName?: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!input.companyId) return;
  await LoggingService.log({
    severity: LogSeverity.SECURITY,
    action: 'VIEW_SENSITIVE_DATA',
    userId: input.userId,
    userName: input.userName,
    companyId: input.companyId,
    entity: input.entity,
    entityId: input.entityId ?? undefined,
    details: input.metadata ?? {},
  });
}

/** Registra VIEW_SENSITIVE_DATA ao montar a tela (PIS, relatórios completos, etc.). */
export function useLgpdSensitiveView(entity: string, entityId: string | null, enabled = true): void {
  const { companyId, user } = useAuth();

  useEffect(() => {
    if (!enabled || !companyId) return;
    void logViewSensitiveClient({
      companyId,
      userId: user?.id,
      userName: user?.nome,
      entity,
      entityId,
      metadata: { source: 'react_mount' },
    });
  }, [enabled, companyId, user?.id, user?.nome, entity, entityId]);
}
