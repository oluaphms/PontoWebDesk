import {
  DEFAULT_PASSWORD_POLICY,
  validatePasswordWithPolicy,
  type PasswordPolicyConfig,
} from './passwordPolicyFromSettings';

/** Valida senha com a política padrão (12 chars, maiúscula, minúscula, número, especial). */
export function validatePassword(pwd: string, policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY): string | null {
  return validatePasswordWithPolicy(pwd, policy);
}
