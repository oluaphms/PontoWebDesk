/**
 * Erros do domínio Master — não misturar com erros HTTP da API principal.
 */
export class MasterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MasterError';
    this.code = code;
  }
}

export type MasterLoginFailureReason =
  | 'invalid_password'
  | 'unknown_account'
  | 'blocked_account';

/**
 * Erro interno de login Master.
 * O controller mantém resposta externa genérica para impedir enumeração,
 * mas a auditoria recebe o estado real.
 */
export class MasterLoginError extends MasterError {
  readonly reason: MasterLoginFailureReason;

  constructor(reason: MasterLoginFailureReason) {
    super('MASTER_INVALID', 'invalid_master_credentials');
    this.name = 'MasterLoginError';
    this.reason = reason;
  }
}

export function notFound(entity: string, id: string): MasterError {
  return new MasterError('MASTER_NOT_FOUND', `${entity} not found: ${id}`);
}

export function conflict(message: string): MasterError {
  return new MasterError('MASTER_CONFLICT', message);
}

export function invalid(message: string): MasterError {
  return new MasterError('MASTER_INVALID', message);
}
