import type { SupabaseClient } from '@supabase/supabase-js';
import { createOperationalCorrelationId } from '../correlationId';
import {
  createOperationalTransactionContext,
  type CreateOperationalTransactionInput,
  type OperationalTransactionContext,
} from './operationalTransactionContext';
import { commitOperationalTransaction } from './operationalUnitOfWork';

export function createOperationalOperationId(): string {
  return crypto.randomUUID();
}

export function beginOperationalTransaction(
  input: Omit<CreateOperationalTransactionInput, 'operation_id' | 'correlation_id'> & {
    operation_id?: string;
    correlation_id?: string;
  },
): OperationalTransactionContext {
  return createOperationalTransactionContext({
    operation_id: input.operation_id ?? createOperationalOperationId(),
    correlation_id: input.correlation_id ?? createOperationalCorrelationId(),
    actor: input.actor,
    company_id: input.company_id,
    source: input.source,
    supabaseClient: input.supabaseClient,
    recovery_meta: input.recovery_meta,
  });
}

export async function withOperationalTransaction<T>(
  client: SupabaseClient,
  init: Omit<CreateOperationalTransactionInput, 'operation_id' | 'correlation_id'> & {
    operation_id?: string;
    correlation_id?: string;
  },
  fn: (ctx: OperationalTransactionContext) => Promise<T>,
): Promise<{ result: T; commit: Awaited<ReturnType<typeof commitOperationalTransaction>> }> {
  const ctx = beginOperationalTransaction(init);
  const result = await fn(ctx);
  const commit = await commitOperationalTransaction(client, ctx);
  return { result, commit };
}

export { commitOperationalTransaction } from './operationalUnitOfWork';
