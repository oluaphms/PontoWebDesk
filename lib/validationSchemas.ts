import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Informe o email ou usuário'),
  password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export function validateLogin(data: { identifier: string; password: string }) {
  return loginSchema.safeParse(data);
}
