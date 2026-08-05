import { z } from 'zod';

export const __CONTEXT__ContractV1 = z.object({
  version: z.literal('v1'),
  company_id: z.string().min(1),
  correlation_id: z.string().nullable(),
  operation_id: z.string().nullable(),
  payload: z.record(z.unknown()).default({}),
});
