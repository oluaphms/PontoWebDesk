import { z } from 'zod';

export const ReplayContractV1 = z.object({
  version: z.literal('v1'),
  company_id: z.string().min(1),
  employee_id: z.string().nullable(),
  correlation_id: z.string().nullable(),
  operation_id: z.string().nullable(),
  replay_id: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  created_at: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type ReplayContract = z.infer<typeof ReplayContractV1>;
