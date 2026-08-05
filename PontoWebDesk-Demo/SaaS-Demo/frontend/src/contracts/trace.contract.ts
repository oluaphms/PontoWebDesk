import { z } from 'zod';

export const TraceSpanContractV1 = z.object({
  version: z.literal('v1'),
  trace_id: z.string().min(1),
  span_id: z.string().min(1),
  parent_span_id: z.string().nullable(),
  type: z.string().min(1),
  source: z.string().min(1),
  started_at: z.string().datetime(),
  finished_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  status: z.enum(['running', 'ok', 'error']),
});

export type TraceSpanContract = z.infer<typeof TraceSpanContractV1>;
