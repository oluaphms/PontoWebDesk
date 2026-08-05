const COMMON_PASSWORDS = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'admin',
  'admin123',
  'qwerty',
  'qwerty123',
  'abc123',
  'letmein',
  'welcome',
  'iloveyou',
  'senha',
  'senha123',
]);

export const PASSWORD_MIN_LENGTH = 12;
export const BCRYPT_COST = 12;

export type PasswordPolicyConfig = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyConfig = {
  minLength: PASSWORD_MIN_LENGTH,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
};

export function passwordPolicyFromRow(row: Record<string, unknown> | null | undefined): PasswordPolicyConfig {
  const minRaw = Number(row?.password_min_length);
  return {
    minLength: Number.isFinite(minRaw) ? Math.min(32, Math.max(6, Math.round(minRaw))) : DEFAULT_PASSWORD_POLICY.minLength,
    requireUppercase: row?.require_uppercase !== false,
    requireLowercase: row?.require_lowercase !== false,
    requireNumbers: row?.require_numbers !== false,
    requireSpecialChars: row?.require_special_chars !== false,
  };
}

export function validatePasswordWithPolicy(password: string, policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY): string | null {
  const value = String(password || '');
  const lower = value.toLowerCase();
  if (value.length < policy.minLength) {
    return `Senha inválida (mínimo ${policy.minLength} caracteres).`;
  }
  if (value.length > 128) return 'Senha deve ter no máximo 128 caracteres.';
  if (COMMON_PASSWORDS.has(lower)) return 'Senha muito comum. Escolha uma senha mais forte.';
  if (policy.requireLowercase && !/[a-z]/.test(value)) return 'Senha deve conter letra minúscula.';
  if (policy.requireUppercase && !/[A-Z]/.test(value)) return 'Senha deve conter letra maiúscula.';
  if (policy.requireNumbers && !/[0-9]/.test(value)) return 'Senha deve conter número.';
  if (policy.requireSpecialChars && !/[^A-Za-z0-9]/.test(value)) return 'Senha deve conter caractere especial.';
  return null;
}

/** @deprecated Use validatePasswordWithPolicy após carregar política da empresa. */
export function validateStrongPassword(password: string): string | null {
  return validatePasswordWithPolicy(password, DEFAULT_PASSWORD_POLICY);
}
