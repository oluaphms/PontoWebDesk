/**
 * Camada de serviço: resolve Supabase e dispara recuperação automática operacional.
 * Mantém o domínio livre de `supabaseClient` (architecture-lint / guardrails).
 */

import { coordinateOperationalAutoRecovery } from '../../domain/operational/recovery/operationalAutoRecoveryCoordinator';
import { getSupabaseClient } from '../supabaseClient';

export async function runOperationalAutoRecovery(reason: string): Promise<void> {
  return coordinateOperationalAutoRecovery(reason, getSupabaseClient());
}
