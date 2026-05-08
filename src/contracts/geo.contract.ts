import { z } from 'zod';

export const GeoContractV1 = z.object({
  version: z.literal('v1'),
  company_id: z.string().min(1),
  employee_id: z.string().min(1),
  provider: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().nonnegative(),
  captured_at: z.string().datetime(),
  correlation_id: z.string().nullable(),
  operation_id: z.string().nullable(),
});

export type GeoContract = z.infer<typeof GeoContractV1>;
