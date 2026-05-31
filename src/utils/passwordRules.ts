export function validatePassword(pwd: string): string | null {
  const common = new Set(['123456', '12345678', 'password', 'admin123', 'qwerty', 'abc123']);
  if (!pwd || pwd.length < 12) return 'A senha deve ter pelo menos 12 caracteres.';
  if (pwd.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (common.has(pwd.toLowerCase())) return 'Senha muito comum. Escolha uma senha mais forte.';
  if (!/[a-z]/.test(pwd)) return 'A senha deve conter letra minúscula.';
  if (!/[A-Z]/.test(pwd)) return 'A senha deve conter letra maiúscula.';
  if (!/[0-9]/.test(pwd)) return 'A senha deve conter número.';
  if (!/[^A-Za-z0-9]/.test(pwd)) return 'A senha deve conter caractere especial.';
  return null;
}
