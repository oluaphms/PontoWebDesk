/**
 * Política de senha forte e proteção contra brute force.
 *
 * Implementa:
 * - Validação de complexidade de senha
 * - Bloqueio após tentativas falhas
 * - Cooldown entre tentativas
 *
 * @security Nível: CRÍTICO
 */

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  score: number; // 0-4 (0 = muito fraca, 4 = forte)
}

export interface BruteForceProtectionResult {
  allowed: boolean;
  remainingAttempts: number;
  lockoutMinutes: number;
  message?: string;
}

// Configurações da política de senha
const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSymbols: true,
  // Lista de senhas comuns proibidas (top 1000)
  forbiddenPasswords: [
    'password', '123456', '12345678', 'qwerty', 'abc123',
    'password123', 'admin', 'root', '123456789', '1234567',
    'welcome', 'monkey', '1234567890', 'password1', '123123',
    '12345', 'letmein', 'football', 'iloveyou', 'admin123',
    'welcome123', 'pontowebdesk', 'ponto123', 'relogio123',
  ],
};

// Configurações de proteção contra brute force
const BRUTE_FORCE_CONFIG = {
  maxAttempts: 5,              // Tentativas antes do bloqueio
  lockoutDurationMinutes: 5,   // Duração do bloqueio
  cooldownSeconds: 1,          // Cooldown entre tentativas
  maxDailyAttempts: 20,        // Máximo de tentativas por dia
};

// Store em memória para tentativas (em produção, usar Redis ou similar)
interface LoginAttempt {
  count: number;
  firstAttemptAt: number;
  lastAttemptAt: number;
  lockedUntil: number | null;
}

const loginAttempts = new Map<string, LoginAttempt>();

/**
 * Valida a complexidade de uma senha.
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  let score = 0;

  // Verificações básicas
  if (!password || password.length === 0) {
    errors.push('Senha é obrigatória');
    return { valid: false, errors, score: 0 };
  }

  // Comprimento mínimo
  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(`Senha deve ter no mínimo ${PASSWORD_POLICY.minLength} caracteres`);
  } else {
    score++;
  }

  // Comprimento máximo
  if (password.length > PASSWORD_POLICY.maxLength) {
    errors.push(`Senha deve ter no máximo ${PASSWORD_POLICY.maxLength} caracteres`);
  }

  // Letras maiúsculas
  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Senha deve conter pelo menos uma letra maiúscula');
  } else if (PASSWORD_POLICY.requireUppercase) {
    score++;
  }

  // Letras minúsculas
  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Senha deve conter pelo menos uma letra minúscula');
  } else if (PASSWORD_POLICY.requireLowercase) {
    score++;
  }

  // Números
  if (PASSWORD_POLICY.requireNumbers && !/\d/.test(password)) {
    errors.push('Senha deve conter pelo menos um número');
  } else if (PASSWORD_POLICY.requireNumbers) {
    score++;
  }

  // Símbolos
  if (PASSWORD_POLICY.requireSymbols && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Senha deve conter pelo menos um símbolo (!@#$%^&*)');
  } else if (PASSWORD_POLICY.requireSymbols) {
    score++;
  }

  // Verificar senhas comuns
  const lowerPassword = password.toLowerCase();
  if (PASSWORD_POLICY.forbiddenPasswords.includes(lowerPassword)) {
    errors.push('Senha muito comum. Escolha uma senha mais segura.');
  }

  // Verificar sequências óbvias
  if (/^[a-zA-Z0-9]*(?:abc|123|qwe|asd|zxc|password|senha|admin|root)[a-zA-Z0-9]*$/i.test(password)) {
    errors.push('Senha contém sequência óbvia');
  }

  // Verificar caracteres repetidos
  if (/(.)(\1{2,})/.test(password)) {
    errors.push('Senha não pode ter caracteres repetidos consecutivamente (ex: aaa)');
  }

  return {
    valid: errors.length === 0 && score >= 3,
    errors,
    score,
  };
}

/**
 * Verifica se o login está permitido (proteção contra brute force).
 */
export function checkBruteForceProtection(identifier: string): BruteForceProtectionResult {
  const now = Date.now();
  const attempt = loginAttempts.get(identifier);

  // Se não há tentativas registradas, permite
  if (!attempt) {
    return {
      allowed: true,
      remainingAttempts: BRUTE_FORCE_CONFIG.maxAttempts,
      lockoutMinutes: 0,
    };
  }

  // Verificar se está bloqueado
  if (attempt.lockedUntil && now < attempt.lockedUntil) {
    const remainingMinutes = Math.ceil((attempt.lockedUntil - now) / (60 * 1000));
    return {
      allowed: false,
      remainingAttempts: 0,
      lockoutMinutes: remainingMinutes,
      message: `Conta temporariamente bloqueada. Tente novamente em ${remainingMinutes} minuto(s).`,
    };
  }

  // Se o bloqueio expirou, limpa o estado
  if (attempt.lockedUntil && now >= attempt.lockedUntil) {
    loginAttempts.delete(identifier);
    return {
      allowed: true,
      remainingAttempts: BRUTE_FORCE_CONFIG.maxAttempts,
      lockoutMinutes: 0,
    };
  }

  // Calcula tentativas restantes
  const remainingAttempts = Math.max(0, BRUTE_FORCE_CONFIG.maxAttempts - attempt.count);

  return {
    allowed: remainingAttempts > 0,
    remainingAttempts,
    lockoutMinutes: 0,
    message: remainingAttempts === 0
      ? `Conta bloqueada após ${BRUTE_FORCE_CONFIG.maxAttempts} tentativas falhas.`
      : `Tentativas restantes: ${remainingAttempts}`,
  };
}

/**
 * Registra uma tentativa de login (sucesso ou falha).
 */
export function recordLoginAttempt(identifier: string, success: boolean): void {
  const now = Date.now();

  if (success) {
    // Limpa tentativas em caso de sucesso
    loginAttempts.delete(identifier);
    return;
  }

  const existing = loginAttempts.get(identifier);

  if (!existing) {
    // Primeira tentativa falha
    loginAttempts.set(identifier, {
      count: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
      lockedUntil: null,
    });
    return;
  }

  // Incrementa contador
  existing.count++;
  existing.lastAttemptAt = now;

  // Verifica se deve bloquear
  if (existing.count >= BRUTE_FORCE_CONFIG.maxAttempts) {
    existing.lockedUntil = now + (BRUTE_FORCE_CONFIG.lockoutDurationMinutes * 60 * 1000);
  }

  loginAttempts.set(identifier, existing);
}

/**
 * Gera uma senha segura aleatória.
 */
export function generateSecurePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  const all = uppercase + lowercase + numbers + symbols;
  let password = '';

  // Garante pelo menos um de cada tipo
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];

  // Preenche o resto
  for (let i = 4; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }

  // Embaralha
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Calcula a força da senha (0-100).
 */
export function calculatePasswordStrength(password: string): number {
  let strength = 0;

  // Comprimento
  if (password.length >= 8) strength += 20;
  if (password.length >= 12) strength += 10;
  if (password.length >= 16) strength += 10;

  // Variedade de caracteres
  if (/[a-z]/.test(password)) strength += 15;
  if (/[A-Z]/.test(password)) strength += 15;
  if (/\d/.test(password)) strength += 15;
  if (/[^a-zA-Z0-9]/.test(password)) strength += 15;

  return Math.min(100, strength);
}

/**
 * Retorna requisitos da política de senha para exibição na UI.
 */
export function getPasswordPolicyRequirements(): {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSymbols: boolean;
  description: string;
} {
  return {
    minLength: PASSWORD_POLICY.minLength,
    requireUppercase: PASSWORD_POLICY.requireUppercase,
    requireLowercase: PASSWORD_POLICY.requireLowercase,
    requireNumbers: PASSWORD_POLICY.requireNumbers,
    requireSymbols: PASSWORD_POLICY.requireSymbols,
    description: `Mínimo ${PASSWORD_POLICY.minLength} caracteres, incluindo maiúscula, minúscula, número e símbolo.`,
  };
}
