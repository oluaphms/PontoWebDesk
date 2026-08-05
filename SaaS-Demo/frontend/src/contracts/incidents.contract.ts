import { z } from 'zod';

export const IncidentPayloadContractV1 = z.object({
  version: z.literal('v1'),
  company_id: z.string().min(1),
  employee_id: z.string().min(1),
  incident_code: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  correlation_id: z.string().nullable(),
  operation_id: z.string().nullable(),
  category: z.string().nullable(),
  recommended_action: z.string().nullable(),
  created_at: z.string().datetime(),
});

export type IncidentPayloadContract = z.infer<typeof IncidentPayloadContractV1>;
