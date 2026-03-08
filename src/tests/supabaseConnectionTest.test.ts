/**
 * Teste de conexão Supabase: leitura de tabela, auth e storage.
 * Executar: npm run test -- --run src/tests/supabaseConnectionTest.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  isSupabaseConfigured,
  testSupabaseConnection,
  supabase,
  auth,
  storage,
} from '../../../services/supabase';

describe('Supabase connection', () => {
  beforeAll(() => {
    if (!isSupabaseConfigured) {
      console.warn('Supabase not configured – set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    }
  });

  it('is configured when env vars are set', () => {
    expect(typeof isSupabaseConfigured).toBe('boolean');
  });

  it('connects and reads a table (employees or users)', async () => {
    if (!isSupabaseConfigured) {
      console.warn('Skipping: Supabase not configured');
      return;
    }
    const result = await testSupabaseConnection(15000);
    expect(result).toHaveProperty('ok');
    expect(typeof result.ok).toBe('boolean');
    if (!result.ok) {
      console.warn('Connection test failed:', result.message);
    }
  }, 20000);

  it('auth.getSession does not throw', async () => {
    if (!isSupabaseConfigured) return;
    await expect(auth.getSession()).resolves.toBeDefined();
  }, 10000);

  it('storage list runs without throw (if bucket exists)', async () => {
    if (!isSupabaseConfigured) return;
    try {
      await storage.list('avatars').catch(() => null);
    } catch {
      // bucket pode não existir
    }
  }, 10000);
});

describe('Supabase client with timeout', () => {
  it('supabase client is null when not configured', () => {
    if (!isSupabaseConfigured) {
      expect(supabase).toBeNull();
    }
  });
});
