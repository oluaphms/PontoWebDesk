export function validatePassword(pwd: string): string | null {
  if (!pwd || pwd.length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
  if (pwd.length > 32) return 'A senha deve ter no máximo 32 caracteres.';
  if (!/^[A-Za-z0-9]+$/.test(pwd)) return 'Use apenas letras e números (sem espaços ou símbolos).';
  if (!/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) return 'A senha deve conter letras e números.';
  return null;
}
