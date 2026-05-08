import { z } from 'zod';

export const EventContractV1 = z.object({
  version: z.literal('v1'),
  event_type: z.string().min(1),
  company_id: z.string().min(1),
  correlation_id: z.string().nullable(),
  operation_id: z.string().nullable(),
  created_at: z.string().datetime(),
  payload: z.record(z.unknown()).default({}),
});

export type EventContract = z.infer<typeof EventContractV1>;
