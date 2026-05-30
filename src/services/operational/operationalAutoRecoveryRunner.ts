/**
 * Camada de serviço: resolve Supabase e dispara recuperação automática operacional.
 * Mantém o domínio livre de `supabaseClient` (architecture-lint / guardrails).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { coordinateOperationalAutoRecovery } from '../../domain/operational/recovery/operationalAutoRecoveryCoordinator';
import { getSupabaseClient } from '../supabaseClient';

export async function runOperationalAutoRecovery(reason: string): Promise<void> {
  const client = getSupabaseClient() as SupabaseClient | null;
  return coordinateOperationalAutoRecovery(reason, client);
}
