import { z } from 'zod';

export const RpcContractV1 = z.object({
  version: z.literal('v1'),
  rpc_name: z.string().min(1),
  company_id: z.string().min(1),
  actor: z.string().nullable(),
  correlation_id: z.string().nullable(),
  operation_id: z.string().nullable(),
  created_at: z.string().datetime(),
  args: z.record(z.unknown()).default({}),
});

export type RpcContract = z.infer<typeof RpcContractV1>;
