/**
 * Erro padronizado do domínio relógio de ponto (multi-fabricante).
 */
export class TimeClockError extends Error {
  readonly code: string;

  readonly vendor?: string;

  readonly httpStatus?: number;

  readonly details?: unknown;

  constructor(
    message: string,
    code = 'TIME_CLOCK_ERROR',
    httpStatus?: number,
    details?: unknown,
    vendor?: string
  ) {
    super(message);
    this.name = 'TimeClockError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.vendor = vendor;
  }
}

export function isTimeClockError(e: unknown): e is TimeClockError {
  return e instanceof TimeClockError;
}
