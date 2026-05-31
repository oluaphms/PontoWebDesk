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

export function validateStrongPassword(password: string): string | null {
  const value = String(password || '');
  const lower = value.toLowerCase();
  if (value.length < PASSWORD_MIN_LENGTH) return `Senha inválida (mínimo ${PASSWORD_MIN_LENGTH} caracteres).`;
  if (COMMON_PASSWORDS.has(lower)) return 'Senha muito comum. Escolha uma senha mais forte.';
  if (!/[a-z]/.test(value)) return 'Senha deve conter letra minúscula.';
  if (!/[A-Z]/.test(value)) return 'Senha deve conter letra maiúscula.';
  if (!/[0-9]/.test(value)) return 'Senha deve conter número.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Senha deve conter caractere especial.';
  return null;
}
