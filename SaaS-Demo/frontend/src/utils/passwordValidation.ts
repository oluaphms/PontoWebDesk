import type { GlobalSettings } from '../types/settings';
import {
  passwordPolicyFromSettings,
  validatePasswordWithPolicy,
  type PasswordPolicyConfig,
} from './passwordPolicyFromSettings';

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Valida senha conforme global_settings (Configurações → Segurança).
 */
export function validatePassword(
  password: string,
  settings: Pick<
    GlobalSettings,
    | 'password_min_length'
    | 'require_uppercase'
    | 'require_lowercase'
    | 'require_numbers'
    | 'require_special_chars'
  > | null,
): PasswordValidationResult {
  const policy: PasswordPolicyConfig = passwordPolicyFromSettings(settings);
  const message = validatePasswordWithPolicy(password, policy);
  return message ? { valid: false, message } : { valid: true };
}
