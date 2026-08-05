import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculatePasswordStrength,
  checkBruteForceProtection,
  recordLoginAttempt,
  validatePassword,
} from './passwordPolicy';

describe('passwordPolicy', () => {
  describe('validatePassword', () => {
    it('rejeita senha vazia', () => {
      const r = validatePassword('');
      expect(r.valid).toBe(false);
      expect(r.errors).toContain('Senha é obrigatória');
    });

    it('rejeita senha comum da lista proibida', () => {
      const r = validatePassword('password123');
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => /comum|proibida|fraca/i.test(e))).toBe(true);
    });

    it('aceita senha forte', () => {
      const r = validatePassword('Str0ng!Pass#2026');
      expect(r.valid).toBe(true);
      expect(r.errors).toHaveLength(0);
      expect(r.score).toBeGreaterThanOrEqual(3);
    });

    it('exige maiúscula, minúscula, número e símbolo', () => {
      const weak = validatePassword('abcdefgh');
      expect(weak.valid).toBe(false);
      expect(weak.errors.length).toBeGreaterThan(0);
    });
  });

  describe('calculatePasswordStrength', () => {
    it('pontua mais para senhas longas e variadas', () => {
      expect(calculatePasswordStrength('abc')).toBeLessThan(calculatePasswordStrength('Abc1!xyzLong'));
    });
  });

  describe('brute force protection', () => {
    const id = 'user-brute-test@example.com';

    beforeEach(() => {
      for (let i = 0; i < 10; i++) recordLoginAttempt(id, true);
    });

    it('bloqueia após tentativas falhas consecutivas', () => {
      for (let i = 0; i < 5; i++) recordLoginAttempt(id, false);
      const check = checkBruteForceProtection(id);
      expect(check.allowed).toBe(false);
      expect(check.remainingAttempts).toBe(0);
      expect(check.lockoutMinutes).toBeGreaterThan(0);
    });

    it('permite após login bem-sucedido', () => {
      recordLoginAttempt(id, false);
      recordLoginAttempt(id, true);
      const check = checkBruteForceProtection(id);
      expect(check.allowed).toBe(true);
    });
  });
});
