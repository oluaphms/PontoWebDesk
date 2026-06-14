import type { Response } from 'express';
import { isProduction } from '../security/env.js';

type SafeErrorBody = {
  ok: false;
  success: false;
  error: string;
  code: string;
  message: string;
  detail?: string;
};

export function sendClientSafeError(
  res: Response,
  status: number,
  code: string,
  devMessage: string,
  extra?: Record<string, unknown>,
): void {
  const body: SafeErrorBody & Record<string, unknown> = {
    ok: false,
    success: false,
    error: code,
    code,
    message: isProduction() ? 'Não foi possível concluir a operação.' : devMessage,
  };

  if (!isProduction() && extra) {
    Object.assign(body, extra);
  }

  res.status(status).json(body);
}
