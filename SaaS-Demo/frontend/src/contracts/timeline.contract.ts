import { z } from 'zod';

export const TimelinePayloadContractV1 = z.object({
  version: z.literal('v1'),
  company_id: z.string().min(1),
  employee_id: z.string().nullable(),
  date: z.string().nullable(),
  event_type: z.string().min(1),
  source: z.string().min(1),
  correlation_id: z.string().nullable(),
  operation_id: z.string().nullable(),
  payload: z.record(z.unknown()).default({}),
});

export type TimelinePayloadContract = z.infer<typeof TimelinePayloadContractV1>;
