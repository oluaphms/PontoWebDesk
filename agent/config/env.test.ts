// @vitest-environment node
/**
 * Testes básicos para validação de env.
 * Estes testes verificam o comportamento de validação.
 *
 * NOTA: Estes testes são manuais/dev-only pois mexem em process.env
 */

import { describe, it, expect, vi } from 'vitest';
import { isValidSupabaseUrl } from './env';
import { installOperationalTestIsolation } from '../../src/testing/operationalTestIsolation';

describe('env validation', () => {
  installOperationalTestIsolation();

  describe('isValidSupabaseUrl', () => {
    it('aceita URL válida do Supabase', () => {
      const url = 'https://abcdefgh12345678.supabase.co';
      expect(isValidSupabaseUrl(url)).toBe(true);
    });

    it('rejeita URL HTTP (não HTTPS)', () => {
      const url = 'http://abcdefgh12345678.supabase.co';
      expect(isValidSupabaseUrl(url)).toBe(false);
    });

    it('rejeita URL sem domínio supabase.co', () => {
      const url = 'https://example.com';
      expect(isValidSupabaseUrl(url)).toBe(false);
    });

    it('rejeita string vazia', () => {
      expect(isValidSupabaseUrl('')).toBe(false);
    });

    it('rejeita URL malformada', () => {
      expect(isValidSupabaseUrl('not-a-url')).toBe(false);
    });
  });
});

// NOTA: Testes de validateEnv() são integração e requerem:
// - .env.local configurado
// - ou mocks de process.env
// Não incluídos aqui para evitar side-effects no processo de teste
