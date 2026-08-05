import type { GlobalSettings } from '../types/settings';

export type PasswordPolicyConfig = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
};

/** Mesma política padrão da tela Redefinir senha (colaboradores). */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicyConfig = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
};

const COMMON_PASSWORDS = new Set([
  '123456',
  '12345678',
  'password',
  'admin123',
  'qwerty',
  'abc123',
  'senha',
  'senha123',
]);

export type PasswordPolicySource = Pick<
  GlobalSettings,
  | 'password_min_length'
  | 'require_uppercase'
  | 'require_lowercase'
  | 'require_numbers'
  | 'require_special_chars'
>;

export function passwordPolicyFromSettings(
  settings: PasswordPolicySource | null | undefined,
): PasswordPolicyConfig {
  const minRaw = Number(settings?.password_min_length);
  return {
    minLength: Number.isFinite(minRaw) ? Math.min(32, Math.max(6, Math.round(minRaw))) : DEFAULT_PASSWORD_POLICY.minLength,
    requireUppercase: settings?.require_uppercase ?? DEFAULT_PASSWORD_POLICY.requireUppercase,
    requireLowercase: settings?.require_lowercase ?? DEFAULT_PASSWORD_POLICY.requireLowercase,
    requireNumbers: settings?.require_numbers ?? DEFAULT_PASSWORD_POLICY.requireNumbers,
    requireSpecialChars: settings?.require_special_chars ?? DEFAULT_PASSWORD_POLICY.requireSpecialChars,
  };
}

export function getPasswordPolicyRules(policy: PasswordPolicyConfig): Array<{ key: string; label: string }> {
  const rules: Array<{ key: string; label: string }> = [
    { key: 'length', label: `Mínimo de ${policy.minLength} caracteres` },
  ];
  if (policy.requireUppercase) {
    rules.push({ key: 'upper', label: 'Pelo menos 1 letra maiúscula' });
  }
  if (policy.requireLowercase) {
    rules.push({ key: 'lower', label: 'Pelo menos 1 letra minúscula' });
  }
  if (policy.requireNumbers) {
    rules.push({ key: 'number', label: 'Pelo menos 1 número' });
  }
  if (policy.requireSpecialChars) {
    rules.push({ key: 'special', label: 'Pelo menos 1 caractere especial' });
  }
  return rules;
}

export function getPasswordChecks(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
): Array<{ label: string; ok: boolean }> {
  const value = String(password || '');
  return getPasswordPolicyRules(policy).map((rule) => {
    let ok = false;
    switch (rule.key) {
      case 'length':
        ok = value.length >= policy.minLength && value.length <= 128;
        break;
      case 'upper':
        ok = /[A-Z]/.test(value);
        break;
      case 'lower':
        ok = /[a-z]/.test(value);
        break;
      case 'number':
        ok = /[0-9]/.test(value);
        break;
      case 'special':
        ok = /[^A-Za-z0-9]/.test(value);
        break;
      default:
        ok = false;
    }
    return { label: rule.label, ok };
  });
}

export type PasswordStrengthInfo = {
  score: number;
  label: string;
  barClass: string;
  textClass: string;
};

export function getPasswordStrengthInfo(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
): PasswordStrengthInfo {
  const checks = getPasswordChecks(password, policy);
  const total = checks.length || 1;
  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / total) * 100);
  const value = String(password || '');

  if (!value) {
    return { score: 0, label: '—', barClass: 'bg-slate-300', textClass: 'text-slate-500' };
  }
  if (score < 40) {
    return { score, label: 'Fraca', barClass: 'bg-red-500', textClass: 'text-red-600 dark:text-red-400' };
  }
  if (score < 70) {
    return { score, label: 'Média', barClass: 'bg-amber-500', textClass: 'text-amber-600 dark:text-amber-400' };
  }
  if (score < 100) {
    return { score, label: 'Boa', barClass: 'bg-sky-500', textClass: 'text-sky-600 dark:text-sky-400' };
  }
  return { score: 100, label: 'Forte', barClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' };
}

export function validatePasswordWithPolicy(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
): string | null {
  const pwd = String(password || '');
  if (!pwd || pwd.length < policy.minLength) {
    return `A senha deve ter pelo menos ${policy.minLength} caracteres.`;
  }
  if (pwd.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (COMMON_PASSWORDS.has(pwd.toLowerCase())) return 'Senha muito comum. Escolha uma senha mais forte.';
  if (policy.requireLowercase && !/[a-z]/.test(pwd)) return 'A senha deve conter letra minúscula.';
  if (policy.requireUppercase && !/[A-Z]/.test(pwd)) return 'A senha deve conter letra maiúscula.';
  if (policy.requireNumbers && !/[0-9]/.test(pwd)) return 'A senha deve conter número.';
  if (policy.requireSpecialChars && !/[^A-Za-z0-9]/.test(pwd)) {
    return 'A senha deve conter caractere especial.';
  }
  return null;
}
